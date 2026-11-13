import type { TemplateLayout } from "../api/routes/templates.js";

export interface FfmpegRenderInput {
  start: number;
  end: number;
  layout: TemplateLayout;
  preset: string;
  fontsDir: string;
  overlayFile?: string;
  captionsFile?: string;
  inputFile?: string;
  outputFile?: string;
}

/** `#RRGGBB` breaks filtergraph (`#` = comment); drive letters break `fontsdir=`. */
export function ffmpegColor(hexOrName: string): string {
  const m = hexOrName.trim().match(/^#([0-9a-fA-F]{6})$/);
  return m ? `0x${m[1]}` : hexOrName;
}

export function escapeFontsDir(fontsDir: string): string {
  // Prefer relative paths (no `:`). Absolute Windows paths must escape `:`.
  return fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Gentle voice level pulse: ~±10% every `periodSec` (default 4.5s). */
export function buildAudioFilter(periodSec = 4.5, depth = 0.1): string {
  const period = Math.min(5, Math.max(4, periodSec));
  const amp = Math.min(0.2, Math.max(0.05, depth));
  return [
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    `volume='1+${amp}*sin(2*PI*t/${period})':eval=frame`,
  ].join(",");
}

export function buildRenderArgs(input: FfmpegRenderInput): string[] {
  const {
    start,
    end,
    layout,
    preset,
    fontsDir,
    overlayFile = "overlay.png",
    captionsFile = "captions.ass",
    inputFile = "original.mp4",
    outputFile = "out.mp4",
  } = input;
  const duration = end - start;
  const { slot, background, canvas } = layout;
  const w = canvas.width;
  const h = canvas.height;
  const fonts = escapeFontsDir(fontsDir);

  let filter: string;
  if (background.type === "color") {
    const color = ffmpegColor(background.color ?? "#000000");
    const fit =
      slot.fit === "contain"
        ? `scale=${slot.width}:${slot.height}:force_original_aspect_ratio=decrease,pad=${slot.width}:${slot.height}:(ow-iw)/2:(oh-ih)/2`
        : `scale=${slot.width}:${slot.height}:force_original_aspect_ratio=increase,crop=${slot.width}:${slot.height}`;
    filter = [
      `color=c=${color}:s=${w}x${h}:d=${duration}[bg]`,
      `[0:v]${fit}[fg]`,
      `[bg][fg]overlay=${slot.x}:${slot.y}[base]`,
      `[base][1:v]overlay=0:0:shortest=1[framed]`,
      `[framed]ass=${captionsFile}:fontsdir=${fonts}[out]`,
    ].join(";");
  } else {
    const fgScale =
      slot.fit === "contain"
        ? `scale=${slot.width}:${slot.height}:force_original_aspect_ratio=decrease,pad=${slot.width}:${slot.height}:(ow-iw)/2:(oh-ih)/2`
        : `scale=${slot.width}:${slot.height}:force_original_aspect_ratio=increase,crop=${slot.width}:${slot.height}`;
    filter = [
      `[0:v]split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bg]`,
      `[fgsrc]${fgScale}[fg]`,
      `[bg][fg]overlay=${slot.x}:${slot.y}[base]`,
      `[base][1:v]overlay=0:0:shortest=1[framed]`,
      `[framed]ass=${captionsFile}:fontsdir=${fonts}[out]`,
    ].join(";");
  }

  return [
    "-y",
    "-ss",
    String(start),
    "-to",
    String(end),
    "-i",
    inputFile,
    "-loop",
    "1",
    "-i",
    overlayFile,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-map",
    "0:a?",
    "-af",
    buildAudioFilter(),
    "-t",
    String(duration),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    outputFile,
  ];
}
