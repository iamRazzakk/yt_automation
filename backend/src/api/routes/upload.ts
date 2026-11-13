import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { ErrorCatalog, makeError } from "../../domain/errors.js";
import { loadConfig } from "../../infra/config.js";
import { getDb } from "../../infra/db.js";
import { assertDiskAllowsNewJobs } from "../../infra/disk.js";
import { enqueueJob } from "../../infra/queues.js";
import { initStorage } from "../../infra/storage/local.js";

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/videos/upload", async (req, reply) => {
    const cfg = loadConfig();
    try {
      await assertDiskAllowsNewJobs();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "DISK_LOW") {
        throw makeError(ErrorCatalog.DISK_LOW, err.message);
      }
      throw e;
    }

    const file = await req.file();
    if (!file) {
      return reply.status(400).send({
        error: { code: "NO_FILE", message: "Expected multipart file field" },
      });
    }

    const db = getDb();
    const storage = initStorage(cfg.STORAGE_ROOT);
    const video = await db.video.create({
      data: {
        sourceType: "upload",
        status: "QUEUED",
        templateId: cfg.DEFAULT_TEMPLATE_ID,
        title: file.filename,
      },
    });

    const tmpDir = storage.localPath(`tmp/${video.id}`);
    await mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, "upload.bin");
    const maxBytes = cfg.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    let written = 0;

    try {
      const out = createWriteStream(tmpPath);
      file.file.on("data", (chunk: Buffer) => {
        written += chunk.length;
        if (written > maxBytes) {
          file.file.destroy(new Error("UPLOAD_TOO_LARGE"));
        }
      });
      await pipeline(file.file, out);

      await db.jobEvent.create({
        data: {
          videoId: video.id,
          stage: "download",
          level: "info",
          message: "Upload received, queued for validation",
        },
      });
      await enqueueJob("download", video.id, {
        videoId: video.id,
        uploadPath: tmpPath,
      });
      return reply.status(202).send({ id: video.id });
    } catch (e) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      await db.video.delete({ where: { id: video.id } }).catch(() => undefined);
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (msg.includes("UPLOAD_TOO_LARGE")) {
        return reply.status(413).send({
          error: {
            code: "UPLOAD_TOO_LARGE",
            message: `Max upload size is ${cfg.MAX_UPLOAD_SIZE_MB} MB`,
          },
        });
      }
      throw e;
    }
  });
}

void randomUUID;
