import { getDb } from "../infra/db.js";

export const SCHEDULE_KEY = "auto_publish_schedule";

export type PublishSchedule = {
  enabled: boolean;
  /** Hours between uploads (default 1). */
  intervalHours: number;
  /** First upload time (ISO). Before this, cron does nothing. */
  startAt: string | null;
};

export const DEFAULT_SCHEDULE: PublishSchedule = {
  enabled: false,
  intervalHours: 1,
  startAt: null,
};

export function parseSchedule(value: unknown): PublishSchedule {
  if (!value || typeof value !== "object") return { ...DEFAULT_SCHEDULE };
  const v = value as Record<string, unknown>;
  const intervalHours =
    typeof v.intervalHours === "number" && v.intervalHours >= 1
      ? Math.min(24, Math.floor(v.intervalHours))
      : 1;
  return {
    enabled: Boolean(v.enabled),
    intervalHours,
    startAt: typeof v.startAt === "string" && v.startAt ? v.startAt : null,
  };
}

export async function getPublishSchedule(): Promise<PublishSchedule> {
  const db = getDb();
  const row = await db.setting.findUnique({ where: { key: SCHEDULE_KEY } });
  return parseSchedule(row?.value);
}

export async function savePublishSchedule(
  input: PublishSchedule,
): Promise<PublishSchedule> {
  const db = getDb();
  const schedule: PublishSchedule = {
    enabled: Boolean(input.enabled),
    intervalHours: Math.max(1, Math.min(24, Math.floor(input.intervalHours || 1))),
    startAt: input.startAt || null,
  };
  await db.setting.upsert({
    where: { key: SCHEDULE_KEY },
    create: { key: SCHEDULE_KEY, value: schedule },
    update: { value: schedule },
  });
  if (schedule.enabled && schedule.startAt) {
    await rescheduleReadyClips(schedule);
  } else {
    // Clear future slots when disabled
    await db.clip.updateMany({
      where: { status: "READY", publishAt: { not: null } },
      data: { publishAt: null },
    });
  }
  return schedule;
}

/** Assign hourly slots from startAt to all READY clips (oldest first). */
export async function rescheduleReadyClips(
  schedule?: PublishSchedule,
): Promise<number> {
  const db = getDb();
  const cfg = schedule ?? (await getPublishSchedule());
  if (!cfg.enabled || !cfg.startAt) return 0;

  const start = new Date(cfg.startAt);
  if (Number.isNaN(start.getTime())) return 0;

  const ready = await db.clip.findMany({
    where: { status: "READY" },
    orderBy: [{ createdAt: "asc" }, { idx: "asc" }],
    select: { id: true },
  });

  const stepMs = cfg.intervalHours * 3600_000;
  let i = 0;
  for (const clip of ready) {
    const at = new Date(start.getTime() + i * stepMs);
    await db.clip.update({
      where: { id: clip.id },
      data: { publishAt: at, ytPrivacy: "public" },
    });
    i += 1;
  }
  return ready.length;
}

/** Next free slot after the latest scheduled READY/queued clip (or startAt). */
export async function assignNextPublishSlot(clipId: string): Promise<Date | null> {
  const db = getDb();
  const cfg = await getPublishSchedule();
  if (!cfg.enabled || !cfg.startAt) return null;

  const start = new Date(cfg.startAt);
  if (Number.isNaN(start.getTime())) return null;

  const stepMs = cfg.intervalHours * 3600_000;
  const latest = await db.clip.findFirst({
    where: {
      status: { in: ["READY", "APPROVED", "PUBLISH_QUEUED", "UPLOADING"] },
      publishAt: { not: null },
      id: { not: clipId },
    },
    orderBy: { publishAt: "desc" },
    select: { publishAt: true },
  });

  let next = start;
  if (latest?.publishAt) {
    next = new Date(latest.publishAt.getTime() + stepMs);
  }
  // Never schedule in the past relative to "now" once start has passed —
  // keep at least one interval after the last slot, or now rounded up.
  const now = Date.now();
  if (next.getTime() < now) {
    const elapsed = now - start.getTime();
    const slots = Math.ceil(elapsed / stepMs);
    next = new Date(start.getTime() + Math.max(slots, 0) * stepMs);
    if (next.getTime() <= now) {
      next = new Date(next.getTime() + stepMs);
    }
  }

  await db.clip.update({
    where: { id: clipId },
    data: { publishAt: next, ytPrivacy: "public" },
  });
  return next;
}
