import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { ErrorCatalog, makeError } from "../domain/errors.js";
import { resolveBin } from "../infra/bins.js";
import { loadConfig } from "../infra/config.js";
import { getDb } from "../infra/db.js";
import { createLogger } from "../infra/logger.js";
import { runCommand } from "../infra/process.js";
import { enqueueJob } from "../infra/queues.js";
import { acquireHeavy } from "../infra/semaphore.js";
import { getStorage } from "../infra/storage/local.js";

const log = createLogger("worker-transcribe");

export async function processTranscribe(job: {
  data: { videoId: string };
}): Promise<void> {
  const { videoId } = job.data;
  const cfg = loadConfig();
  const db = getDb();
  const storage = getStorage(cfg.STORAGE_ROOT);
  const tmpRoot = storage.localPath(`tmp/transcribe-${videoId}`);
  let release: (() => Promise<void>) | null = null;

  try {
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) throw new UnrecoverableError("Video not found");
    if (video.status === "CANCELLED") return;

    const existing = await db.transcript.findUnique({ where: { videoId } });
    if (existing) {
      await enqueueJob("analyze", videoId, { videoId });
      return;
    }
    if (!video.audioKey) {
      throw new UnrecoverableError("Missing audio key");
    }

    await db.video.update({
      where: { id: videoId },
      data: {
        status: "TRANSCRIBING",
        progress: 0,
        stageDetail: "Transcribing",
      },
    });

    await mkdir(tmpRoot, { recursive: true });
    const audioPath = storage.localPath(video.audioKey);
    const outPath = join(tmpRoot, "transcript.json");
    const scriptPath = join(process.cwd(), "scripts", "transcribe.py");

    release = await acquireHeavy(`transcribe:${videoId}`);
    let python = await resolveBin("python", "PYTHON_PATH");
    try {
      await runCommand(python, ["--version"], { timeoutMs: 5_000 });
    } catch {
      python = await resolveBin("python3", "PYTHON_PATH");
    }
    const result = await runCommand(
      python,
      [
        scriptPath,
        "--audio",
        audioPath,
        "--model",
        cfg.WHISPER_MODEL,
        "--device",
        cfg.WHISPER_DEVICE,
        "--compute",
        cfg.WHISPER_COMPUTE_TYPE,
        "--out",
        outPath,
      ],
      {
        timeoutMs: 90 * 60_000,
        onStdout: async (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as { progress?: number };
              if (typeof msg.progress === "number") {
                await db.video.update({
                  where: { id: videoId },
                  data: { progress: Math.round(msg.progress * 100) },
                });
              }
            } catch {
              // ignore non-json lines
            }
          }
        },
      },
    );

    if (result.code !== 0) {
      throw makeError(
        ErrorCatalog.TRANSCRIBE_FAILED,
        result.stderr.slice(0, 500) || "Transcription failed",
      );
    }

    const data = JSON.parse(await readFile(outPath, "utf8")) as {
      language?: string;
      segments: Array<{ words?: unknown[] }>;
    };
    const wordCount = data.segments.reduce(
      (n, s) => n + (s.words?.length ?? 0),
      0,
    );
    if (wordCount < 50) {
      throw makeError(
        ErrorCatalog.NO_SPEECH,
        `Not enough speech detected (${wordCount} words; need ≥50). Try a video with clear talking audio.`,
      );
    }

    await db.transcript.create({
      data: {
        videoId,
        language: data.language ?? null,
        data: JSON.parse(JSON.stringify(data)) as object,
      },
    });
    await db.video.update({
      where: { id: videoId },
      data: {
        status: "ANALYZING",
        progress: 0,
        stageDetail: "Transcription complete",
      },
    });
    await db.jobEvent.create({
      data: {
        videoId,
        stage: "transcribe",
        level: "info",
        message: `Transcript saved (${wordCount} words)`,
      },
    });
    await enqueueJob("analyze", videoId, { videoId });
  } catch (e) {
    await fail(videoId, e);
    if (e && typeof e === "object" && "retryable" in e && !(e as { retryable: boolean }).retryable) {
      const msg = e instanceof Error ? e.message : "Unrecoverable transcribe error";
      throw new UnrecoverableError(msg);
    }
    throw e;
  } finally {
    if (release) await release().catch(() => undefined);
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fail(videoId: string, e: unknown): Promise<void> {
  const db = getDb();
  const err = e as {
    code?: string;
    category?: "USER_INPUT" | "EXTERNAL" | "SYSTEM";
    message?: string;
  };
  log.error({ videoId, err: e }, "transcribe failed");
  await db.video.update({
    where: { id: videoId },
    data: {
      status: "FAILED",
      errorCode: err.code ?? "TRANSCRIBE_FAILED",
      errorCategory: err.category ?? "SYSTEM",
      errorMessage: err.message ?? "Transcription failed",
    },
  });
  await db.jobEvent.create({
    data: {
      videoId,
      stage: "transcribe",
      level: "error",
      message: err.message ?? "Transcription failed",
    },
  });
}
