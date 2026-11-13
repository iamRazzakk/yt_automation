import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { assertClipTransition } from "../../domain/transitions.js";
import {
  generateFallbackMetadata,
  sanitizeMetadata,
} from "../../domain/metadata-sanitize.js";
import { loadConfig } from "../../infra/config.js";
import { getDb } from "../../infra/db.js";
import { generateClipMetadata } from "../../infra/ollama.js";
import { enqueueJob } from "../../infra/queues.js";
import { getStorage } from "../../infra/storage/local.js";

const patchBody = z.object({
  ytTitle: z.string().optional(),
  ytDescription: z.string().optional(),
  ytTags: z.array(z.string()).optional(),
  ytPrivacy: z.enum(["private", "unlisted", "public"]).optional(),
});

export async function clipRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  app.get("/api/clips/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const clip = await db.clip.findUnique({
      where: { id },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            status: true,
            originalDeletedAt: true,
          },
        },
      },
    });
    if (!clip) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Clip not found" },
      });
    }
    return serializeClip(clip);
  });

  app.patch("/api/clips/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = patchBody.parse(req.body);
    const clip = await db.clip.findUnique({ where: { id } });
    if (!clip) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Clip not found" },
      });
    }
    if (clip.status !== "READY" && clip.status !== "PUBLISH_FAILED") {
      throw Object.assign(
        new Error("Clip metadata can only be edited when READY or PUBLISH_FAILED"),
        { code: "INVALID_TRANSITION", statusCode: 409 },
      );
    }
    const sanitized = sanitizeMetadata({
      titles: body.ytTitle
        ? [body.ytTitle, ...clip.titleOptions.filter((t) => t !== body.ytTitle)]
        : clip.titleOptions,
      description: body.ytDescription ?? clip.ytDescription,
      tags: body.ytTags ?? clip.ytTags,
      hook: clip.hookText ?? "",
    });
    const updated = await db.clip.update({
      where: { id },
      data: {
        ytTitle: body.ytTitle ? sanitized.titles[0]! : clip.ytTitle,
        ytDescription: sanitized.description,
        ytTags: sanitized.tags,
        ...(body.ytPrivacy ? { ytPrivacy: body.ytPrivacy } : {}),
        ...(body.ytTitle ? { titleOptions: sanitized.titles } : {}),
      },
    });
    return serializeClip(updated);
  });

  app.post("/api/clips/:id/approve", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const clip = await db.clip.findUnique({ where: { id } });
    if (!clip) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Clip not found" },
      });
    }
    if (clip.status !== "READY" && clip.status !== "PUBLISH_FAILED") {
      throw Object.assign(new Error("Clip is not approvable"), {
        code: "INVALID_TRANSITION",
        statusCode: 409,
      });
    }
    const account = await db.youtubeAccount.findUnique({ where: { id: 1 } });
    if (!account || account.needsReconnect) {
      return reply.status(400).send({
        error: {
          code: "YT_NOT_CONNECTED",
          message: "Connect YouTube in Settings before approving",
        },
      });
    }
    await db.clip.update({
      where: { id },
      data: {
        status: "PUBLISH_QUEUED",
        approvedAt: new Date(),
        // Manual approve = publish now (clear schedule slot)
        publishAt: new Date(),
        ytPrivacy: "public",
      },
    });
    await enqueueJob("publish", id, { clipId: id });
    return { ok: true };
  });

  app.post("/api/clips/:id/reject", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const clip = await db.clip.findUnique({ where: { id } });
    if (!clip) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Clip not found" },
      });
    }
    assertClipTransition(clip.status, "REJECTED");
    const updated = await db.clip.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    return serializeClip(updated);
  });

  app.post("/api/clips/:id/regenerate-metadata", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const clip = await db.clip.findUnique({ where: { id } });
    if (!clip) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Clip not found" },
      });
    }
    if (clip.status !== "READY" && clip.status !== "PUBLISH_FAILED") {
      throw Object.assign(new Error("Cannot regenerate metadata in this state"), {
        code: "INVALID_TRANSITION",
        statusCode: 409,
      });
    }

    const transcript = await db.transcript.findUnique({
      where: { videoId: clip.videoId },
    });
    const words =
      (
        transcript?.data as {
          segments?: Array<{ words?: Array<{ w: string; start: number; end: number }> }>;
        } | null
      )?.segments?.flatMap((s) => s.words ?? []) ?? [];
    const clipWords = words.filter(
      (w) => w.end >= clip.startSec && w.start <= clip.endSec,
    );
    const clipText =
      clipWords.map((w) => w.w).join(" ").trim() ||
      clip.ytDescription ||
      clip.ytTitle;

    const cfg = loadConfig();
    let meta = generateFallbackMetadata(clipText);
    if (!cfg.OLLAMA_DISABLED) {
      try {
        const llmMeta = await generateClipMetadata(clipText.slice(0, 3500));
        meta = sanitizeMetadata(llmMeta);
      } catch {
        // keep fallback
      }
    }

    const updated = await db.clip.update({
      where: { id },
      data: {
        titleOptions: meta.titles,
        ytTitle: meta.titles[0]!,
        ytDescription: meta.description,
        ytTags: meta.tags,
        hookText: meta.hook,
        ytPrivacy: "public",
      },
    });
    return serializeClip(updated);
  });

  app.get("/api/clips/:id/video", async (req, reply) => {
    return streamClipFile(req, reply, "video");
  });

  app.get("/api/clips/:id/thumbnail", async (req, reply) => {
    return streamClipFile(req, reply, "thumb");
  });
}

async function streamClipFile(
  req: FastifyRequest,
  reply: FastifyReply,
  kind: "video" | "thumb",
) {
  const db = getDb();
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Clip not found" },
    });
  }
  const key = kind === "video" ? clip.videoKey : clip.thumbKey;
  if (!key) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "File not available" },
    });
  }
  const storage = getStorage();
  const path = storage.localPath(key);
  const s = await stat(path);
  const range = req.headers.range;
  const contentType = kind === "video" ? "video/mp4" : "image/jpeg";

  if (range) {
    const m = /^bytes=(\d+)-(\d+)?$/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : s.size - 1;
      reply
        .status(206)
        .header("Content-Type", contentType)
        .header("Content-Length", end - start + 1)
        .header("Content-Range", `bytes ${start}-${end}/${s.size}`)
        .header("Accept-Ranges", "bytes");
      return reply.send(createReadStream(path, { start, end }));
    }
  }

  reply
    .header("Content-Type", contentType)
    .header("Content-Length", s.size)
    .header("Accept-Ranges", "bytes");
  return reply.send(createReadStream(path));
}

function serializeClip<T extends { sizeBytes: bigint | null }>(clip: T) {
  return {
    ...clip,
    sizeBytes: clip.sizeBytes !== null ? clip.sizeBytes.toString() : null,
  };
}
