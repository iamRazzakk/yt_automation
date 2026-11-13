import { Queue } from "bullmq";
import { getRedis } from "./redis.js";

export const QUEUE_NAMES = {
  download: "download",
  transcribe: "transcribe",
  analyze: "analyze",
  render: "render",
  publish: "publish",
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q;
}

export async function enqueueJob(
  queue: QueueName,
  entityId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  // BullMQ rejects ":" in custom job ids; use "-" (SPEC: `${stage}:{entityId}`).
  const jobId = `${queue}-${entityId}`;
  const q = getQueue(queue);
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    // Retry after fail/complete must re-add; waiting/active is already queued.
    if (
      state === "waiting" ||
      state === "delayed" ||
      state === "active" ||
      state === "paused" ||
      state === "waiting-children"
    ) {
      return;
    }
    await existing.remove();
  }
  try {
    await q.add(
      queue,
      { entityId, ...data },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already (exists|exists with this id)|Job .* exists/i.test(msg)) {
      return;
    }
    throw err;
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
