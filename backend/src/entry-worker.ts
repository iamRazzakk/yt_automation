import { mkdir } from "node:fs/promises";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { loadConfig } from "./infra/config.js";
import { getDb } from "./infra/db.js";
import { createLogger } from "./infra/logger.js";
import { getRedis } from "./infra/redis.js";
import { initStorage } from "./infra/storage/local.js";
import { processAnalyze } from "./workers/analyze.js";
import { processDownload } from "./workers/download.js";
import { processMaintenance } from "./workers/maintenance.js";
import { processPublish } from "./workers/publish.js";
import { processRender } from "./workers/render.js";
import { processScheduledPublish } from "./workers/scheduled-publish.js";
import { processTranscribe } from "./workers/transcribe.js";
import { QUEUE_NAMES } from "./infra/queues.js";
import { getQueue } from "./infra/queues.js";

const log = createLogger("worker");

/** Whisper/ffmpeg can outlive a short lock; renewals need headroom if the event loop stalls. */
const LOCK_MS = {
  download: 15 * 60_000,
  transcribe: 90 * 60_000,
  analyze: 15 * 60_000,
  render: 30 * 60_000,
  publish: 30 * 60_000,
} as const;

const IN_FLIGHT_VIDEO = new Set([
  "QUEUED",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "RENDERING",
]);

async function markOrphanedFailure(job: Job, err: Error): Promise<void> {
  const videoId =
    typeof job.data?.videoId === "string" ? job.data.videoId : undefined;
  const clipId =
    typeof job.data?.clipId === "string" ? job.data.clipId : undefined;
  if (!videoId && !clipId) return;

  const db = getDb();
  const message =
    err.message?.slice(0, 500) || "Job failed after worker interruption";

  if (clipId && videoId) {
    const clip = await db.clip.findUnique({ where: { id: clipId } });
    if (clip && (clip.status === "RENDERING" || clip.status === "UPLOADING")) {
      await db.clip.update({
        where: { id: clipId },
        data: {
          status: clip.status === "UPLOADING" ? "PUBLISH_FAILED" : "RENDER_FAILED",
          errorCode: "JOB_INTERRUPTED",
          errorMessage: message,
        },
      });
      await db.jobEvent.create({
        data: {
          videoId,
          clipId,
          stage: job.queueName,
          level: "error",
          message,
        },
      });
    }
    return;
  }

  if (!videoId) return;
  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video || !IN_FLIGHT_VIDEO.has(video.status)) return;

  await db.video.update({
    where: { id: videoId },
    data: {
      status: "FAILED",
      errorCode: "JOB_INTERRUPTED",
      errorCategory: "SYSTEM",
      errorMessage: message,
    },
  });
  await db.jobEvent.create({
    data: {
      videoId,
      stage: job.queueName,
      level: "error",
      message,
    },
  });
}

async function main() {
  const cfg = loadConfig();
  await mkdir(cfg.STORAGE_ROOT, { recursive: true });
  initStorage(cfg.STORAGE_ROOT);
  const connection = getRedis();

  const workers = [
    new Worker(QUEUE_NAMES.download, (job) => processDownload(job), {
      connection,
      concurrency: cfg.WORKER_DOWNLOAD_CONCURRENCY,
      lockDuration: LOCK_MS.download,
      maxStalledCount: 2,
    }),
    new Worker(QUEUE_NAMES.transcribe, (job) => processTranscribe(job), {
      connection,
      concurrency: cfg.WORKER_TRANSCRIBE_CONCURRENCY,
      lockDuration: LOCK_MS.transcribe,
      maxStalledCount: 2,
    }),
    new Worker(QUEUE_NAMES.analyze, (job) => processAnalyze(job), {
      connection,
      concurrency: cfg.WORKER_ANALYZE_CONCURRENCY,
      lockDuration: LOCK_MS.analyze,
      maxStalledCount: 2,
    }),
    new Worker(QUEUE_NAMES.render, (job) => processRender(job), {
      connection,
      concurrency: cfg.WORKER_RENDER_CONCURRENCY,
      lockDuration: LOCK_MS.render,
      maxStalledCount: 2,
    }),
    new Worker(QUEUE_NAMES.publish, (job) => processPublish(job), {
      connection,
      concurrency: cfg.WORKER_PUBLISH_CONCURRENCY,
      lockDuration: LOCK_MS.publish,
      maxStalledCount: 2,
    }),
    new Worker(QUEUE_NAMES.maintenance, async (job) => {
      if (job.name === "scheduled-publish") {
        await processScheduledPublish();
        return;
      }
      await processMaintenance();
    }, {
      connection,
      concurrency: 1,
    }),
  ];

  for (const w of workers) {
    w.on("failed", (job, err) => {
      log.error({ jobId: job?.id, name: job?.name, err }, "job failed");
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? 1;
      // Worker handlers already persist AppError failures; this catches stall/crash orphans.
      if (job.attemptsMade < maxAttempts && !(err instanceof UnrecoverableError)) {
        return;
      }
      void markOrphanedFailure(job, err).catch((e) =>
        log.error({ jobId: job.id, err: e }, "failed to mark orphaned job"),
      );
    });
    w.on("completed", (job) => {
      log.info({ jobId: job.id, name: job.name }, "job completed");
    });
    w.on("stalled", (jobId) => {
      log.warn({ jobId, queue: w.name }, "job stalled; will retry if attempts remain");
    });
  }

  // Schedule daily maintenance at 03:00 via repeatable job
  await getQueue("maintenance").add(
    "daily",
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "maintenance-daily",
    },
  );

  // Auto-publish: check every minute for one due clip (1/hour slots)
  await getQueue("maintenance").add(
    "scheduled-publish",
    {},
    {
      repeat: { every: 60_000 },
      jobId: "scheduled-publish-tick",
    },
  );

  log.info("Workers started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
