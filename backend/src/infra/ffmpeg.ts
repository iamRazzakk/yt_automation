import { resolveBin } from "./bins.js";
import { runCommand } from "./process.js";

export async function ffprobeJson(filePath: string): Promise<{
  streams: Array<Record<string, unknown>>;
  format: Record<string, unknown>;
}> {
  const ffprobe = await resolveBin("ffprobe", "FFPROBE_PATH");
  const result = await runCommand(
    ffprobe,
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      filePath,
    ],
    { timeoutMs: 60_000 },
  );
  if (result.code !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as {
    streams: Array<Record<string, unknown>>;
    format: Record<string, unknown>;
  };
}

export function hasVideoAndAudio(probe: {
  streams: Array<Record<string, unknown>>;
}): boolean {
  const hasV = probe.streams.some((s) => s.codec_type === "video");
  const hasA = probe.streams.some((s) => s.codec_type === "audio");
  return hasV && hasA;
}

export async function extractWav(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const ffmpeg = await resolveBin("ffmpeg", "FFMPEG_PATH");
  const result = await runCommand(
    ffmpeg,
    [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    { timeoutMs: 30 * 60_000 },
  );
  if (result.code !== 0) {
    throw new Error(`ffmpeg audio extract failed: ${result.stderr}`);
  }
}
