import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, ErrorCatalog, makeError } from "../../domain/errors.js";
import { assertVideoTransition } from "../../domain/transitions.js";
import { loadConfig } from "../../infra/config.js";
import { getDb } from "../../infra/db.js";
import { assertDiskAllowsNewJobs } from "../../infra/disk.js";
import { enqueueJob } from "../../infra/queues.js";
import { extractYoutubeId, normalizeYoutubeUrl } from "../../infra/ytdlp.js";

const createBody = z.object({
  url: z.string().min(1),
  templateId: z.string().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

export async function videoRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  app.post("/api/videos", async (req, reply) => {
    const body = createBody.parse(req.body);
    const cfg = loadConfig();

    const canonicalUrl = normalizeYoutubeUrl(body.url);
    if (!canonicalUrl) {
      throw makeError(ErrorCatalog.URL_INVALID, "Only YouTube URLs are allowed");
    }

    try {
      await assertDiskAllowsNewJobs();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "DISK_LOW") {
        throw makeError(ErrorCatalog.DISK_LOW, err.message);
      }
      throw e;
    }

    const sourceVideoId = extractYoutubeId(canonicalUrl);
    const duplicate = sourceVideoId
      ? await db.video.findFirst({
          where: { sourceVideoId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null;

    const video = await db.video.create({
      data: {
        sourceType: "youtube",
        sourceUrl: canonicalUrl,
        sourceVideoId,
        status: "QUEUED",
        templateId: body.templateId ?? cfg.DEFAULT_TEMPLATE_ID,
      },
    });

    await db.jobEvent.create({
      data: {
        videoId: video.id,
        stage: "download",
        level: "info",
        message: "Video queued for download",
      },
    });

    await enqueueJob("download", video.id, { videoId: video.id });

    return reply.status(202).send({
      id: video.id,
      ...(duplicate ? { duplicateOf: duplicate.id } : {}),
    });
  });

  app.get("/api/videos", async (req) => {
    const q = listQuery.parse(req.query);
    const [items, total] = await Promise.all([
      db.video.findMany({
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          clips: {
            where: { thumbKey: { not: null } },
            take: 1,
            orderBy: { idx: "asc" },
            select: { thumbKey: true, id: true },
          },
        },
      }),
      db.video.count(),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get("/api/videos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await db.video.findUnique({
      where: { id },
      include: {
        clips: { orderBy: { idx: "asc" } },
        events: { orderBy: { id: "desc" }, take: 50 },
      },
    });
    if (!video) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Video not found" },
      });
    }
    // BigInt fields (clip.sizeBytes, event.id) → strings for JSON
    return {
      ...video,
      clips: video.clips.map((clip) => ({
        ...clip,
        sizeBytes: clip.sizeBytes !== null ? clip.sizeBytes.toString() : null,
      })),
      events: video.events.map((event) => ({
        ...event,
        id: event.id.toString(),
      })),
    };
  });

  app.post("/api/videos/:id/cancel", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Video not found" },
      });
    }
    if (video.status === "CANCELLED" || video.status === "READY") {
      throw Object.assign(new Error(`Cannot cancel from ${video.status}`), {
        code: "INVALID_TRANSITION",
        statusCode: 409,
      });
    }
    assertVideoTransition(video.status, "CANCELLED");
    const updated = await db.video.update({
      where: { id },
      data: { status: "CANCELLED", stageDetail: "Cancelled by user" },
    });
    await db.jobEvent.create({
      data: {
        videoId: id,
        level: "warn",
        message: "Video cancelled",
      },
    });
    return updated;
  });

  app.post("/api/videos/:id/retry", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Video not found" },
      });
    }
    if (video.status !== "FAILED") {
      throw Object.assign(new Error("Only FAILED videos can be retried"), {
        code: "INVALID_TRANSITION",
        statusCode: 409,
      });
    }

    const stage = mapErrorToStage(video.errorCode);
    assertVideoTransition("FAILED", stage);
    await db.video.update({
      where: { id },
      data: {
        status: stage,
        progress: 0,
        errorCode: null,
        errorCategory: null,
        errorMessage: null,
        stageDetail: `Retrying ${stage.toLowerCase()}`,
      },
    });
    if (stage === "RENDERING") {
      const failedClips = await db.clip.findMany({
        where: { videoId: id, status: "RENDER_FAILED" },
        select: { id: true },
      });
      await db.clip.updateMany({
        where: { videoId: id, status: "RENDER_FAILED" },
        data: { status: "RENDERING", errorCode: null, errorMessage: null },
      });
      for (const clip of failedClips) {
        await enqueueJob("render", clip.id, { clipId: clip.id, videoId: id });
      }
      return { ok: true, stage, clips: failedClips.length };
    }
    const queue = stageToQueue(stage);
    await enqueueJob(queue, id, { videoId: id });
    return { ok: true, stage };
  });

  app.delete("/api/videos/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const uploading = await db.clip.count({
      where: { videoId: id, status: "UPLOADING" },
    });
    if (uploading > 0) {
      throw new AppError({
        code: "CONFLICT",
        category: "USER_INPUT",
        retryable: false,
        message: "Cannot delete while a clip is uploading",
      });
    }
    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Video not found" },
      });
    }
    await db.video.delete({ where: { id } });
    return { ok: true };
  });
}

function mapErrorToStage(
  errorCode: string | null,
): "DOWNLOADING" | "TRANSCRIBING" | "ANALYZING" | "RENDERING" {
  switch (errorCode) {
    case "TRANSCRIBE_FAILED":
      return "TRANSCRIBING";
    case "NO_CLIPS":
      return "ANALYZING";
    case "RENDER_FAILED":
      return "RENDERING";
    default:
      return "DOWNLOADING";
  }
}

function stageToQueue(
  stage: "DOWNLOADING" | "TRANSCRIBING" | "ANALYZING" | "RENDERING",
) {
  switch (stage) {
    case "DOWNLOADING":
      return "download" as const;
    case "TRANSCRIBING":
      return "transcribe" as const;
    case "ANALYZING":
      return "analyze" as const;
    case "RENDERING":
      return "render" as const;
  }
}
