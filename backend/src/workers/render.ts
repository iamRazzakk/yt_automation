import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { loadTemplate } from "../api/routes/templates.js";
import { buildAssCaptions } from "../domain/captions-ass.js";
import { ErrorCatalog, makeError } from "../domain/errors.js";
import { buildRenderArgs } from "../domain/ffmpeg-args.js";
import type { Word } from "../domain/sentences.js";
import { resolveBin } from "../infra/bins.js";
import { loadConfig } from "../infra/config.js";
import { getDb } from "../infra/db.js";
import { ffprobeJson, hasVideoAndAudio } from "../infra/ffmpeg.js";
import { createLogger } from "../infra/logger.js";
import { runCommand } from "../infra/process.js";
import { getStorage } from "../infra/storage/local.js";

const log = createLogger("worker-render");

export async function processRender(job: {
  data: { clipId: string; videoId: string };
}): Promise<void> {
  const { clipId, videoId } = job.data;
  const cfg = loadConfig();
  const db = getDb();
  const storage = getStorage(cfg.STORAGE_ROOT);
  const tmpRoot = storage.localPath(`tmp/render-${clipId}`);

  try {
    const clip = await db.clip.findUnique({ where: { id: clipId } });
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!clip || !video) throw new UnrecoverableError("Clip/video not found");
    if (video.status === "CANCELLED") return;
    if (clip.status === "READY" && clip.videoKey) {
      await maybeFinishVideo(videoId);
      return;
    }
    if (!video.originalKey) throw new UnrecoverableError("Missing original");

    await mkdir(tmpRoot, { recursive: true });
    const layout = await loadTemplate(video.templateId);
    const transcript = await db.transcript.findUnique({ where: { videoId } });
    const data = (transcript?.data ?? { segments: [] }) as unknown as {
      segments: Array<{ words?: Word[] }>;
    };
    const words = data.segments.flatMap((s) => s.words ?? []);

    const ass = buildAssCaptions(
      words,
      clip.startSec,
      clip.endSec,
      layout.canvas,
      layout.caption,
    );
    await writeFile(join(tmpRoot, "captions.ass"), ass, "utf8");

    const overlaySrc = join(
      process.cwd(),
      "..",
      "assets",
      "templates",
      video.templateId,
      layout.overlay,
    );
    await copyFile(overlaySrc, join(tmpRoot, "overlay.png"));
    await copyFile(storage.localPath(video.originalKey), join(tmpRoot, "original.mp4"));

    // Relative fontsdir avoids Windows `C:` breaking the filtergraph.
    const fontsLocal = join(tmpRoot, "fonts");
    await stageFonts(fontsLocal, layout.caption.font);
    const args = buildRenderArgs({
      start: clip.startSec,
      end: clip.endSec,
      layout,
      preset: cfg.FFMPEG_PRESET,
      fontsDir: "fonts",
    });

    const ffmpeg = await resolveBin("ffmpeg", "FFMPEG_PATH");
    const result = await runCommand(ffmpeg, args, {
      cwd: tmpRoot,
      timeoutMs: 10 * 60_000,
    });
    if (result.code !== 0) {
      const errTail = result.stderr.trim().slice(-600);
      throw makeError(ErrorCatalog.RENDER_FAILED, errTail || "ffmpeg failed");
    }

    const outPath = join(tmpRoot, "out.mp4");
    const probe = await ffprobeJson(outPath);
    if (!hasVideoAndAudio(probe)) {
      throw makeError(ErrorCatalog.RENDER_FAILED, "Rendered file missing streams");
    }
    const dur = Number(probe.format.duration ?? 0);
    if (dur < cfg.CLIP_MIN_SEC - 2 || dur > 59.5) {
      throw makeError(
        ErrorCatalog.RENDER_FAILED,
        `Rendered duration out of range: ${dur}`,
      );
    }

    const videoKey = `clips/${videoId}/${clipId}.mp4`;
    await storage.put(videoKey, outPath);
    const st = await storage.stat(videoKey);

    let thumbKey: string | null = null;
    if (cfg.THUMBNAILS_ENABLED) {
      try {
        const { generateThumbnail } = await import("../infra/thumbnail.js");
        thumbKey = await generateThumbnail({
          originalPath: storage.localPath(video.originalKey),
          start: clip.startSec,
          end: clip.endSec,
          title: clip.hookText ?? clip.ytTitle,
          templateId: video.templateId,
          layout,
          outKey: `clips/${videoId}/${clipId}.jpg`,
          tmpRoot,
          storage,
        });
      } catch (e) {
        log.warn({ clipId, err: e }, "thumbnail failed");
        await db.jobEvent.create({
          data: {
            videoId,
            clipId,
            stage: "render",
            level: "warn",
            message: "Thumbnail generation failed",
          },
        });
      }
    }

    const expiresAt = new Date(
      Date.now() + cfg.CLIP_RETENTION_DAYS * 24 * 3600_000,
    );
    await db.clip.update({
      where: { id: clipId },
      data: {
        status: "READY",
        videoKey,
        thumbKey,
        sizeBytes: st ? BigInt(st.size) : null,
        expiresAt,
        ytPrivacy: cfg.YT_DEFAULT_PRIVACY,
        errorCode: null,
        errorMessage: null,
      },
    });
    const { assignNextPublishSlot } = await import("../domain/publish-schedule.js");
    await assignNextPublishSlot(clipId);
    await db.jobEvent.create({
      data: {
        videoId,
        clipId,
        stage: "render",
        level: "info",
        message: "Clip rendered",
      },
    });
    await maybeFinishVideo(videoId);
  } catch (e) {
    await failClip(clipId, videoId, e);
    throw e;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function maybeFinishVideo(videoId: string): Promise<void> {
  const db = getDb();
  const clips = await db.clip.findMany({ where: { videoId } });
  if (clips.length === 0) return;
  const terminal = clips.every((c) =>
    ["READY", "RENDER_FAILED", "REJECTED"].includes(c.status),
  );
  if (!terminal) return;
  const ready = clips.filter((c) => c.status === "READY").length;
  if (ready > 0) {
    await db.video.update({
      where: { id: videoId },
      data: { status: "READY", progress: 100, stageDetail: "Ready for review" },
    });
  } else {
    await db.video.update({
      where: { id: videoId },
      data: {
        status: "FAILED",
        errorCode: "RENDER_FAILED",
        errorCategory: "SYSTEM",
        errorMessage: "All clips failed to render",
      },
    });
  }
}

async function failClip(clipId: string, videoId: string, e: unknown): Promise<void> {
  const db = getDb();
  const err = e as { code?: string; message?: string };
  log.error({ clipId, videoId, err: e }, "render failed");
  await db.clip.update({
    where: { id: clipId },
    data: {
      status: "RENDER_FAILED",
      errorCode: err.code ?? "RENDER_FAILED",
      errorMessage: err.message ?? "Render failed",
    },
  });
  await maybeFinishVideo(videoId);
}

async function stageFonts(destDir: string, preferredFamily: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const assetsFonts = join(process.cwd(), "..", "assets", "fonts");
  let copied = 0;
  try {
    for (const name of await readdir(assetsFonts)) {
      if (!/\.(ttf|otf|ttc)$/i.test(name)) continue;
      await copyFile(join(assetsFonts, name), join(destDir, name));
      copied += 1;
    }
  } catch {
    // assets/fonts may be missing
  }
  if (copied > 0) return;

  // Dev fallback: map caption family → a system font file.
  const winFonts = join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
  const candidates = [
    `${preferredFamily}.ttf`,
    `${preferredFamily}.TTF`,
    "arial.ttf",
    "Arial.ttf",
    "segoeui.ttf",
  ];
  for (const name of candidates) {
    try {
      await copyFile(join(winFonts, name), join(destDir, `${preferredFamily}.ttf`));
      return;
    } catch {
      // try next
    }
  }
  throw makeError(
    ErrorCatalog.RENDER_FAILED,
    `No fonts found in assets/fonts (need ${preferredFamily}.ttf)`,
  );
}
