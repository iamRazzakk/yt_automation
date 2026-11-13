/**
 * Build overlay.png / thumb_overlay.png from assets/templates/default/image.png
 * by cutting a transparent rounded hole where the video sits.
 */
import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "templates",
  "default",
);

const src = join(root, "image.png");
const outOverlay = join(root, "overlay.png");
const outThumb = join(root, "thumb_overlay.png");

/** Measured from image.png (rixnet frame). */
const SLOT = { x: 24, y: 250, width: 1032, height: 1240 };
const RADIUS = 72;

function isRed(r, g, b) {
  return r > 110 && r > g * 1.4 && r > b * 1.4 && r - Math.max(g, b) > 30;
}

function insideRoundedRect(x, y, rx, ry, rw, rh, rad) {
  const lx = x - rx;
  const ly = y - ry;
  if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) return false;
  if (lx >= rad && lx < rw - rad) return true;
  if (ly >= rad && ly < rh - rad) return true;
  const corners = [
    [rad, rad],
    [rw - rad - 1, rad],
    [rad, rh - rad - 1],
    [rw - rad - 1, rh - rad - 1],
  ];
  for (const [cx, cy] of corners) {
    const inThis =
      (cx < rw / 2 ? lx < rad : lx >= rw - rad) &&
      (cy < rh / 2 ? ly < rad : ly >= rh - rad);
    if (!inThis) continue;
    const dx = lx - cx;
    const dy = ly - cy;
    if (dx * dx + dy * dy <= rad * rad) return true;
  }
  return false;
}

const { data, info } = await sharp(src)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const out = Buffer.from(data);

let cleared = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (!insideRoundedRect(x, y, SLOT.x, SLOT.y, SLOT.width, SLOT.height, RADIUS)) {
      continue;
    }
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    if (isRed(r, g, b)) continue;
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = 0;
    cleared++;
  }
}

await sharp(out, { raw: { width: w, height: h, channels: 4 } })
  .png()
  .toFile(outOverlay);
await copyFile(outOverlay, outThumb);

console.log(
  JSON.stringify(
    { slot: SLOT, radius: RADIUS, cleared, overlay: outOverlay },
    null,
    2,
  ),
);
