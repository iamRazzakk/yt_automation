import type { FastifyInstance } from "fastify";
import { getDb } from "../../infra/db.js";
import { getDiskStatus } from "../../infra/disk.js";
import { QUEUE_NAMES, getQueue } from "../../infra/queues.js";
import { loadConfig } from "../../infra/config.js";

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/system/stats", async () => {
    const cfg = loadConfig();
    const db = getDb();
    const disk = await getDiskStatus();

    const queueCounts: Record<string, number> = {};
    for (const name of Object.values(QUEUE_NAMES)) {
      const q = getQueue(name);
      const counts = await q.getJobCounts("waiting", "active", "delayed", "failed");
      queueCounts[name] =
        (counts.waiting ?? 0) +
        (counts.active ?? 0) +
        (counts.delayed ?? 0);
    }

    const since30 = new Date(Date.now() - 30 * 24 * 3600_000);
    const since7 = new Date(Date.now() - 7 * 24 * 3600_000);

    const [all30, system30, all7, system7] = await Promise.all([
      db.video.count({
        where: { createdAt: { gte: since30 }, status: { not: "CANCELLED" } },
      }),
      db.video.count({
        where: {
          createdAt: { gte: since30 },
          status: "FAILED",
          errorCategory: "SYSTEM",
        },
      }),
      db.video.count({
        where: { createdAt: { gte: since7 }, status: { not: "CANCELLED" } },
      }),
      db.video.count({
        where: {
          createdAt: { gte: since7 },
          status: "FAILED",
          errorCategory: "SYSTEM",
        },
      }),
    ]);

    let ollama: { ok: boolean; hasModel: boolean; models: string[] } = {
      ok: false,
      hasModel: false,
      models: [],
    };
    try {
      const res = await fetch(`${cfg.OLLAMA_HOST}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string }[] };
        const models = (data.models ?? []).map((m) => m.name);
        ollama = {
          ok: true,
          hasModel: models.some(
            (n) => n === cfg.OLLAMA_MODEL || n.startsWith(`${cfg.OLLAMA_MODEL}:`),
          ),
          models,
        };
      }
    } catch {
      // Ollama down is fine
    }

    return {
      disk,
      queues: queueCounts,
      ollama,
      ollamaDisabled: cfg.OLLAMA_DISABLED,
      failureRate: {
        d7: all7 === 0 ? 0 : system7 / all7,
        d30: all30 === 0 ? 0 : system30 / all30,
        systemFailures7: system7,
        systemFailures30: system30,
        total7: all7,
        total30: all30,
      },
      tools: {
        note: "Versions filled by worker health probe when available",
      },
    };
  });
}
