import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { ErrorCatalog, makeError } from "../domain/errors.js";
import { loadConfig } from "../infra/config.js";
import { getDb } from "../infra/db.js";
import { assertFreeSpaceForDownload } from "../infra/disk.js";
import { extractWav, ffprobeJson, hasVideoAndAudio } from "../infra/ffmpeg.js";
import { resolveYtDlp } from "../infra/bins.js";
import { createLogger } from "../infra/logger.js";
import { runCommand } from "../infra/process.js";
import { enqueueJob } from "../infra/queues.js";
import { getStorage } from "../infra/storage/local.js";
import { extractYoutubeId } from "../infra/ytdlp.js";

const log = createLogger("worker-download");

export async function processDownload(job: {
  data: { videoId: string; uploadPath?: string };
}): Promise<void> {
  const { videoId, uploadPath } = job.data;
  const cfg = loadConfig();
  const db = getDb();
  const storage = getStorage(cfg.STORAGE_ROOT);
  const tmpRoot = storage.localPath(`tmp/${jobId("download", videoId)}`);

  try {
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) throw new UnrecoverableError("Video not found");
    if (video.status === "CANCELLED") return;
    if (video.originalKey && video.audioKey) {
      await enqueueJob("transcribe", videoId, { videoId });
      return;
    }

    await db.video.update({
      where: { id: videoId },
      data: { status: "DOWNLOADING", progress: 0, stageDetail: "Starting download" },
    });
    await mkdir(tmpRoot, { recursive: true });

    let localOriginal = join(tmpRoot, "original.mp4");

    if (video.sourceType === "upload" || uploadPath) {
      const src = uploadPath ?? join(storage.localPath(`tmp/${videoId}`), "upload.bin");
      await rename(src, localOriginal).catch(async () => {
        // if already moved, try copy via storage put later
        localOriginal = src;
      });
    } else {
      if (!video.sourceUrl) {
        throw new UnrecoverableError("Missing source URL");
      }

      const ytdlp = await resolveYtDlp();
      const metaArgs = [
        ...ytdlp.prefixArgs,
        "--dump-json",
        "--no-playlist",
        video.sourceUrl,
      ];
      if (cfg.YTDLP_COOKIES_PATH) {
        metaArgs.splice(ytdlp.prefixArgs.length + 2, 0, "--cookies", cfg.YTDLP_COOKIES_PATH);
      }
      const meta = await runCommand(ytdlp.cmd, metaArgs, { timeoutMs: 120_000 });
      if (meta.code !== 0) {
        mapDownloadError(meta.stderr);
      }
      const info = JSON.parse(meta.stdout) as {
        title?: string;
        duration?: number;
        filesize_approx?: number;
        is_live?: boolean;
        id?: string;
      };
      if (info.is_live) {
        throw makeError(ErrorCatalog.VIDEO_UNAVAILABLE, "Live streams are not supported");
      }
      const duration = info.duration ?? 0;
      if (duration > cfg.MAX_VIDEO_DURATION_MIN * 60) {
        throw makeError(
          ErrorCatalog.VIDEO_TOO_LONG,
          `Video is longer than ${cfg.MAX_VIDEO_DURATION_MIN} minutes`,
        );
      }
      const approx = info.filesize_approx ?? 1.5 * 1024 * 1024 * 1024;
      await assertFreeSpaceForDownload(approx);

      await db.video.update({
        where: { id: videoId },
        data: {
          title: info.title ?? video.title,
          durationSec: Math.round(duration),
          sourceVideoId: info.id ?? extractYoutubeId(video.sourceUrl),
          stageDetail: "Downloading",
        },
      });

      const outTemplate = join(tmpRoot, "original.%(ext)s");
      const dlArgs = [
        ...ytdlp.prefixArgs,
        "--no-playlist",
        "--newline",
        "-f",
        "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        outTemplate,
        video.sourceUrl,
      ];
      if (cfg.YTDLP_COOKIES_PATH) {
        dlArgs.splice(dlArgs.length - 1, 0, "--cookies", cfg.YTDLP_COOKIES_PATH);
      }

      const dl = await runCommand(ytdlp.cmd, dlArgs, {
        timeoutMs: 20 * 60_000,
        onStdout: async (chunk) => {
          const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(chunk);
          if (m) {
            const pct = Math.min(95, Math.round(Number(m[1])));
            await db.video.update({
              where: { id: videoId },
              data: { progress: pct },
            });
          }
        },
      });
      if (dl.code !== 0) {
        mapDownloadError(dl.stderr + dl.stdout);
      }
      localOriginal = join(tmpRoot, "original.mp4");
    }

    const cancelled = await db.video.findUnique({ where: { id: videoId } });
    if (cancelled?.status === "CANCELLED") return;

    const probe = await ffprobeJson(localOriginal);
    if (!hasVideoAndAudio(probe)) {
      throw makeError(ErrorCatalog.MEDIA_CORRUPT, "Media missing video or audio stream");
    }
    const dur = Number(probe.format.duration ?? 0);
    if (dur <= 60) {
      throw makeError(ErrorCatalog.MEDIA_CORRUPT, "Media duration must be > 60 seconds");
    }

    const wavPath = join(tmpRoot, "audio.wav");
    await extractWav(localOriginal, wavPath);

    const originalKey = `videos/${videoId}/original.mp4`;
    const audioKey = `videos/${videoId}/audio.wav`;
    await storage.put(originalKey, localOriginal);
    await storage.put(audioKey, wavPath);

    await db.video.update({
      where: { id: videoId },
      data: {
        originalKey,
        audioKey,
        durationSec: Math.round(dur),
        status: "TRANSCRIBING",
        progress: 0,
        stageDetail: "Download complete",
      },
    });
    await db.jobEvent.create({
      data: {
        videoId,
        stage: "download",
        level: "info",
        message: "Download and audio extract complete",
      },
    });
    await enqueueJob("transcribe", videoId, { videoId });
  } catch (e) {
    await failVideo(videoId, e);
    if (e instanceof UnrecoverableError) throw e;
    if (e && typeof e === "object" && "retryable" in e && !(e as { retryable: boolean }).retryable) {
      const msg = e instanceof Error ? e.message : "Unrecoverable download error";
      throw new UnrecoverableError(msg);
    }
    throw e;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function jobId(stage: string, id: string) {
  return `${stage}-${id}`;
}

function mapDownloadError(stderr: string): never {
  const s = stderr.toLowerCase();
  if (
    s.includes("sign in to confirm") ||
    s.includes("http error 403") ||
    s.includes("429")
  ) {
    throw makeError(
      ErrorCatalog.DOWNLOAD_BLOCKED,
      "Download blocked. Upload the file instead or provide a cookies file.",
    );
  }
  if (
    s.includes("private video") ||
    s.includes("unavailable") ||
    s.includes("age") ||
    s.includes("not available")
  ) {
    throw makeError(ErrorCatalog.VIDEO_UNAVAILABLE, "Video unavailable");
  }
  throw makeError(ErrorCatalog.VIDEO_UNAVAILABLE, `yt-dlp failed: ${stderr.slice(0, 300)}`);
}

async function failVideo(videoId: string, e: unknown): Promise<void> {
  const db = getDb();
  const err = e as {
    code?: string;
    category?: "USER_INPUT" | "EXTERNAL" | "SYSTEM";
    message?: string;
  };
  const code = err.code ?? "DOWNLOAD_FAILED";
  const category = err.category ?? "SYSTEM";
  log.error({ videoId, err: e }, "download failed");
  await db.video.update({
    where: { id: videoId },
    data: {
      status: "FAILED",
      errorCode: code,
      errorCategory: category,
      errorMessage: err.message ?? "Download failed",
    },
  });
  await db.jobEvent.create({
    data: {
      videoId,
      stage: "download",
      level: "error",
      message: err.message ?? "Download failed",
      data: { code },
    },
  });
}
