import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getPublishSchedule,
  savePublishSchedule,
  type PublishSchedule,
} from "../../domain/publish-schedule.js";
import { getDb } from "../../infra/db.js";

const bodySchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(24).default(1),
  startAt: z
    .string()
    .nullable()
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), {
      message: "startAt must be a valid ISO date",
    }),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  app.get("/api/settings/publish-schedule", async () => {
    const schedule = await getPublishSchedule();
    const upcoming = await db.clip.findMany({
      where: {
        status: "READY",
        publishAt: { not: null },
      },
      orderBy: { publishAt: "asc" },
      take: 12,
      select: {
        id: true,
        ytTitle: true,
        publishAt: true,
        ytPrivacy: true,
        videoId: true,
      },
    });
    return { schedule, upcoming };
  });

  app.put("/api/settings/publish-schedule", async (req) => {
    const body = bodySchema.parse(req.body);
    const schedule: PublishSchedule = {
      enabled: body.enabled,
      intervalHours: body.intervalHours,
      startAt: body.startAt,
    };
    const saved = await savePublishSchedule(schedule);
    const upcoming = await db.clip.findMany({
      where: { status: "READY", publishAt: { not: null } },
      orderBy: { publishAt: "asc" },
      take: 12,
      select: {
        id: true,
        ytTitle: true,
        publishAt: true,
        ytPrivacy: true,
        videoId: true,
      },
    });
    return { schedule: saved, upcoming };
  });
}
