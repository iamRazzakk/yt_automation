import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { TemplateLayout } from "../api/routes/templates.js";
import { resolveBin } from "./bins.js";
import { runCommand } from "./process.js";
import type { LocalStorage } from "./storage/local.js";

const LAPLACIAN = Buffer.from([
  0, 1, 0,
  1, -4, 1,
  0, 1, 0,
].map((n) => n)); // placeholder; use convolve kernel via sharp

export async function generateThumbnail(opts: {
  originalPath: string;
  start: number;
  end: number;
  title: string;
  templateId: string;
  layout: TemplateLayout;
  outKey: string;
  tmpRoot: string;
  storage: LocalStorage;
}): Promise<string> {
  const { start, end, layout, tmpRoot, storage, outKey, originalPath, title, templateId } =
    opts;
  const framesDir = join(tmpRoot, "frames");
  await mkdir(framesDir, { recursive: true });
  const duration = Math.max(0.1, end - start);
  const scores: Array<{ path: string; score: number }> = [];

  for (let i = 0; i < 8; i++) {
    const t = start + (duration * (i + 0.5)) / 8;
    const framePath = join(framesDir, `f${i}.jpg`);
    const ffmpeg = await resolveBin("ffmpeg", "FFMPEG_PATH");
    await runCommand(
      ffmpeg,
      [
        "-y",
        "-ss",
        String(t),
        "-i",
        originalPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${layout.thumbnail.width}:${layout.thumbnail.height}:force_original_aspect_ratio=increase,crop=${layout.thumbnail.width}:${layout.thumbnail.height}`,
        framePath,
      ],
      { timeoutMs: 60_000 },
    );
    const score = await sharpnessScore(framePath);
    scores.push({ path: framePath, score });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!;
  const overlayPath = join(
    process.cwd(),
    "..",
    "assets",
    "templates",
    templateId,
    layout.thumbnail.overlay,
  );

  const hook = title.split(/\s+/).slice(0, 6).join(" ");
  const box = layout.thumbnail.titleBox;
  const svg = `
    <svg width="${layout.thumbnail.width}" height="${layout.thumbnail.height}">
      <style>
        .t { fill: white; font-size: ${box.fontSize}px; font-family: Inter, sans-serif; font-weight: 700; }
      </style>
      <foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="color:white;font-size:${box.fontSize}px;font-weight:700;font-family:Inter,sans-serif;line-height:1.15">${escapeXml(hook)}</div>
      </foreignObject>
    </svg>`;

  let img = sharp(best.path).resize(layout.thumbnail.width, layout.thumbnail.height);
  try {
    const overlay = await readFile(overlayPath);
    img = img.composite([
      { input: overlay },
      { input: Buffer.from(svg) },
    ]);
  } catch {
    img = img.composite([{ input: Buffer.from(svg) }]);
  }

  const outPath = join(tmpRoot, "thumb.jpg");
  let quality = 85;
  let buf = await img.jpeg({ quality }).toBuffer();
  while (buf.length > 2 * 1024 * 1024 && quality > 40) {
    quality -= 10;
    buf = await sharp(buf).jpeg({ quality }).toBuffer();
  }
  await writeFile(outPath, buf);
  await storage.put(outKey, outPath);
  return outKey;
}

async function sharpnessScore(path: string): Promise<number> {
  const { data, info } = await sharp(path)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Simple variance of Laplacian approximation via neighbor differences
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const w = info.width;
  const h = info.height;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        -4 * data[i]! +
        data[i - 1]! +
        data[i + 1]! +
        data[i - w]! +
        data[i + w]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return Math.sqrt(sumSq / n - mean * mean);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

void LAPLACIAN;
