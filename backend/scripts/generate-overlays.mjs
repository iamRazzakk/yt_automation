import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "templates", "default");

async function makeOverlay(name, hole = true) {
  const w = 1080;
  const h = 1920;
  // Full-frame overlay with transparent video hole (y=420, 1080x1080)
  const svg = `
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <mask id="m">
        <rect width="${w}" height="${h}" fill="white"/>
        ${hole ? `<rect x="0" y="420" width="1080" height="1080" fill="black"/>` : ""}
      </mask>
    </defs>
    <rect width="${w}" height="${h}" fill="#0b0f14" mask="url(#m)"/>
    <rect x="40" y="80" width="1000" height="8" fill="#3ddc97" opacity="0.9"/>
    <text x="540" y="280" text-anchor="middle" fill="#e8eef5" font-size="56" font-family="Arial, sans-serif" font-weight="700">SHORTS STUDIO</text>
    <rect x="40" y="1820" width="1000" height="6" fill="#3ddc97" opacity="0.6"/>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(join(root, name), buf);
}

await makeOverlay("overlay.png", true);
await makeOverlay("thumb_overlay.png", false);
console.log("overlays written");
