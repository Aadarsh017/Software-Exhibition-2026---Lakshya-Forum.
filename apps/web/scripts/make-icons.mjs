// Draws the app icons from app/icon.svg (DESIGN.md 7.8). Run again after changing the icon:
//   node apps/web/scripts/make-icons.mjs
// sharp comes with Next.js, so nothing extra is installed.
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const web = fileURLToPath(new URL("..", import.meta.url));
const svg = await readFile(`${web}app/icon.svg`, "utf8");

// The coral background is the first shape; the bubble and the moon are everything after it.
const background = svg.match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"[^>]*\/>/);
if (!background) throw new Error("app/icon.svg: expected a filled <rect> first");
const coral = background[1];
const mark = svg.slice(svg.indexOf(background[0]) + background[0].length, svg.lastIndexOf("</svg>"));

// A full square (the launcher or iOS rounds it) with the mark scaled about its centre (32, 35).
// Maskable icons must keep everything inside the middle 80% circle, so the mark is smaller there.
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${coral}"/>` +
  `<g transform="translate(32 32) scale(${scale}) translate(-32 -35)">${mark}</g></svg>`;

async function draw(source, size, out) {
  await sharp(Buffer.from(source), { density: Math.ceil((72 * size) / 64) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${web}${out}`);
  console.log(`${out} (${size}×${size})`);
}

await mkdir(`${web}public/icons`, { recursive: true });
await draw(svg, 192, "public/icons/icon-192.png");
await draw(svg, 512, "public/icons/icon-512.png");
await draw(fullBleed(0.7), 512, "public/icons/maskable-512.png");
await draw(fullBleed(0.8), 180, "app/apple-icon.png");
