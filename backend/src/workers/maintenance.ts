import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../infra/config.js";
import { getDb } from "../infra/db.js";
import { createLogger } from "../infra/logger.js";
import { runCommand } from "../infra/process.js";
import { getStorage } from "../infra/storage/local.js";

const log = createLogger("worker-maintenance");

export async function processMaintenance(): Promise<void> {
  const cfg = loadConfig();
  const db = getDb();
  const storage = getStorage(cfg.STORAGE_ROOT);
  const now = Date.now();

  // Original retention
  const originalCutoff = new Date(
    now - cfg.ORIGINAL_RETENTION_DAYS * 24 * 3600_000,
  );
  const oldVideos = await db.video.findMany({
    where: {
      status: { in: ["READY", "FAILED"] },
      originalDeletedAt: null,
      updatedAt: { lt: originalCutoff },
      OR: [{ originalKey: { not: null } }, { audioKey: { not: null } }],
    },
  });
  for (const v of oldVideos) {
    if (v.originalKey) await storage.delete(v.originalKey).catch(() => undefined);
    if (v.audioKey) await storage.delete(v.audioKey).catch(() => undefined);
    await db.video.update({
      where: { id: v.id },
      data: { originalKey: null, audioKey: null, originalDeletedAt: new Date() },
    });
  }

  // Expired clips (not in-flight publish)
  const expired = await db.clip.findMany({
    where: {
      expiresAt: { lt: new Date() },
      status: { notIn: ["APPROVED", "PUBLISH_QUEUED", "UPLOADING"] },
    },
  });
  for (const c of expired) {
    if (c.videoKey) await storage.delete(c.videoKey).catch(() => undefined);
    if (c.thumbKey) await storage.delete(c.thumbKey).catch(() => undefined);
    await db.clip.update({
      where: { id: c.id },
      data: { videoKey: null, thumbKey: null },
    });
  }

  // Rejected after 1 day
  const rejectedCutoff = new Date(now - 24 * 3600_000);
  const rejected = await db.clip.findMany({
    where: {
      status: "REJECTED",
      updatedAt: { lt: rejectedCutoff },
      OR: [{ videoKey: { not: null } }, { thumbKey: { not: null } }],
    },
  });
  for (const c of rejected) {
    if (c.videoKey) await storage.delete(c.videoKey).catch(() => undefined);
    if (c.thumbKey) await storage.delete(c.thumbKey).catch(() => undefined);
    await db.clip.update({
      where: { id: c.id },
      data: { videoKey: null, thumbKey: null },
    });
  }

  // Orphan tmp older than 6h
  const tmpRoot = storage.localPath("tmp");
  try {
    const entries = await readdir(tmpRoot, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(tmpRoot, entry.name);
      const s = await stat(p);
      if (now - s.mtimeMs > 6 * 3600_000) {
        await rm(p, { recursive: true, force: true });
      }
    }
  } catch {
    // no tmp yet
  }

  // Weekly yt-dlp update (best-effort; cron caller decides frequency)
  try {
    const result = await runCommand("yt-dlp", ["-U"], { timeoutMs: 5 * 60_000 });
    log.info({ stdout: result.stdout.slice(0, 200) }, "yt-dlp update");
  } catch (e) {
    log.warn({ err: e }, "yt-dlp update failed");
  }

  log.info(
    {
      originalsCleared: oldVideos.length,
      clipsExpired: expired.length,
      rejectedCleared: rejected.length,
    },
    "maintenance complete",
  );
}
