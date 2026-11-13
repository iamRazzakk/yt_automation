import { getDb } from "../infra/db.js";
import { createLogger } from "../infra/logger.js";
import { enqueueJob } from "../infra/queues.js";
import { getPublishSchedule } from "../domain/publish-schedule.js";

const log = createLogger("worker-scheduled-publish");

/**
 * Every tick: if schedule is active and start time has passed,
 * publish at most one READY clip whose publishAt <= now.
 */
export async function processScheduledPublish(): Promise<void> {
  const schedule = await getPublishSchedule();
  if (!schedule.enabled || !schedule.startAt) return;

  const start = new Date(schedule.startAt);
  if (Number.isNaN(start.getTime()) || Date.now() < start.getTime()) {
    return;
  }

  const db = getDb();
  const account = await db.youtubeAccount.findUnique({ where: { id: 1 } });
  if (!account || account.needsReconnect) {
    log.warn("skip scheduled publish: YouTube not connected");
    return;
  }

  // Only one upload per hour window: if something is already uploading, wait.
  const busy = await db.clip.count({
    where: { status: { in: ["PUBLISH_QUEUED", "UPLOADING"] } },
  });
  if (busy > 0) return;

  const due = await db.clip.findFirst({
    where: {
      status: "READY",
      publishAt: { lte: new Date() },
      videoKey: { not: null },
    },
    orderBy: [{ publishAt: "asc" }, { createdAt: "asc" }],
  });
  if (!due) return;

  await db.clip.update({
    where: { id: due.id },
    data: {
      status: "PUBLISH_QUEUED",
      approvedAt: new Date(),
      ytPrivacy: "public",
    },
  });
  await db.jobEvent.create({
    data: {
      videoId: due.videoId,
      clipId: due.id,
      stage: "publish",
      level: "info",
      message: `Auto-publish scheduled slot ${due.publishAt?.toISOString() ?? ""}`,
    },
  });
  await enqueueJob("publish", due.id, { clipId: due.id });
  log.info({ clipId: due.id, publishAt: due.publishAt }, "enqueued scheduled publish");
}
