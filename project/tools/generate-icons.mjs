import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const iconDir = join(rootDir, "icons");

mkdirSync(iconDir, { recursive: true });
writePng(join(iconDir, "icon-192.png"), 192);
writePng(join(iconDir, "icon-512.png"), 512);

console.log("Generated icons/icon-192.png and icons/icon-512.png");

function writePng(filePath, size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    pixels[rowStart] = 0;

    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const color = getPixelColor(x, y, size);
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createChunk("IHDR", createIhdr(size, size)),
    createChunk("IDAT", deflateSync(pixels, { level: 9 })),
    createChunk("IEND", Buffer.alloc(0)),
  ]);

  writeFileSync(filePath, png);
}

function getPixelColor(x, y, size) {
  const scale = size / 512;
  const cornerRadius = 104 * scale;
  const distanceToEdge = roundedRectDistance(x + 0.5, y + 0.5, size, size, cornerRadius);

  if (distanceToEdge > 0) {
    return [0, 0, 0, 0];
  }

  const chatBox = {
    x: 112 * scale,
    y: 94 * scale,
    width: 288 * scale,
    height: 238 * scale,
    radius: 60 * scale,
  };

  const bubbleDistance = roundedRectDistance(
    x + 0.5 - chatBox.x,
    y + 0.5 - chatBox.y,
    chatBox.width,
    chatBox.height,
    chatBox.radius
  );
  const tail = pointInTriangle(
    x,
    y,
    164 * scale,
    332 * scale,
    248 * scale,
    332 * scale,
    164 * scale,
    404 * scale
  );

  if (bubbleDistance <= 0 || tail) {
    const inVertical = x >= 240 * scale && x <= 274 * scale && y >= 150 * scale && y <= 300 * scale;
    const inHorizontal = x >= 182 * scale && x <= 332 * scale && y >= 208 * scale && y <= 242 * scale;
    if (inVertical || inHorizontal) {
      return [18, 107, 99, 255];
    }

    return [223, 242, 237, 255];
  }

  const dotCenters = [184, 256, 328].map((centerX) => [centerX * scale, 382 * scale]);
  const isDot = dotCenters.some(([dotX, dotY]) => Math.hypot(x - dotX, y - dotY) <= 18 * scale);
  if (isDot) {
    return [223, 242, 237, 255];
  }

  return [18, 107, 99, 255];
}

function roundedRectDistance(x, y, width, height, radius) {
  const dx = Math.abs(x - width / 2) - width / 2 + radius;
  const dy = Math.abs(y - height / 2) - height / 2 + radius;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
  const area1 = Math.abs((ax - px) * (by - py) - (bx - px) * (ay - py));
  const area2 = Math.abs((bx - px) * (cy - py) - (cx - px) * (by - py));
  const area3 = Math.abs((cx - px) * (ay - py) - (ax - px) * (cy - py));
  return Math.abs(area - area1 - area2 - area3) < 0.01;
}

function createIhdr(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return ihdr;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}