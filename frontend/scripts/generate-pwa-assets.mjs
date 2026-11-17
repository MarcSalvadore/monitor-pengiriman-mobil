import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../public');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, drawPixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = drawPixel(x, y, width, height);
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(maskable) {
  return (x, y, w, h) => {
    const nx = x / w;
    const ny = y / h;
    const cx = nx - 0.5;
    const cy = ny - 0.5;
    const dist = Math.sqrt(cx * cx + cy * cy);

    // Background slate-900 (#0f172a) to slate-950 (#020617) gradient
    let r = 15;
    let g = 23;
    let b = 42;

    if (!maskable) {
      // Rounded-square subtle accent border
      const margin = 0.06;
      const inBox =
        nx >= margin && nx <= 1 - margin && ny >= margin && ny <= 1 - margin;
      if (!inBox) {
        return [15, 23, 42, 255];
      }
    }

    // Central route circle / ring in sky-500 (#0ea5e9) & emerald-400 (#34d399)
    const ringRadius = maskable ? 0.28 : 0.34;
    const ringThickness = 0.045;
    if (Math.abs(dist - ringRadius) < ringThickness) {
      r = 56;
      g = 189;
      b = 248;
    }

    // Stylized diagonal route path + origin/dest pins inside safe area
    const onLine =
      Math.abs((ny - 0.5) + 0.65 * (nx - 0.5)) < 0.032 &&
      Math.abs(nx - 0.5) < (maskable ? 0.16 : 0.2);
    if (onLine) {
      r = 52;
      g = 211;
      b = 153;
    }

    const originDist = Math.hypot(nx - 0.36, ny - 0.59);
    const destDist = Math.hypot(nx - 0.64, ny - 0.41);
    if (originDist < 0.055) {
      r = 56;
      g = 189;
      b = 248;
    }
    if (destDist < 0.055) {
      r = 16;
      g = 185;
      b = 129;
    }

    return [r, g, b, 255];
  };
}

function drawScreenshot(wide) {
  return (x, y, w, h) => {
    const nx = x / w;
    const ny = y / h;
    // Slate-950 shell
    let r = 2;
    let g = 6;
    let b = 23;

    if (wide) {
      // Left sidebar
      if (nx < 0.18) {
        r = 15;
        g = 23;
        b = 42;
      } else if (ny < 0.1) {
        // Header
        r = 15;
        g = 23;
        b = 42;
      } else if (nx > 0.2 && nx < 0.56 && ny > 0.14 && ny < 0.94) {
        // Form card
        r = 30;
        g = 41;
        b = 59;
      } else if (nx > 0.58 && nx < 0.98 && ny > 0.14 && ny < 0.94) {
        // Map panel
        r = 17;
        g = 24;
        b = 39;
        if (Math.abs((ny - 0.54) + 0.5 * (nx - 0.78)) < 0.008) {
          r = 56;
          g = 189;
          b = 248;
        }
      }
    } else {
      // Narrow mobile layout
      if (ny < 0.08 || ny > 0.91) {
        r = 15;
        g = 23;
        b = 42;
      } else if (nx > 0.05 && nx < 0.95 && ny > 0.11 && ny < 0.55) {
        r = 30;
        g = 41;
        b = 59;
      } else if (nx > 0.05 && nx < 0.95 && ny > 0.58 && ny < 0.88) {
        r = 17;
        g = 24;
        b = 39;
      }
    }
    return [r, g, b, 255];
  };
}

fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const assets = [
  ['pwa-192x192.png', 192, 192, drawIcon(false)],
  ['pwa-512x512.png', 512, 512, drawIcon(false)],
  ['pwa-maskable-192x192.png', 192, 192, drawIcon(true)],
  ['pwa-maskable-512x512.png', 512, 512, drawIcon(true)],
  ['apple-touch-icon.png', 180, 180, drawIcon(false)],
  ['screenshot-wide.png', 1280, 720, drawScreenshot(true)],
  ['screenshot-narrow.png', 720, 1280, drawScreenshot(false)],
];

for (const [filename, width, height, drawer] of assets) {
  const outPath = path.join(PUBLIC_DIR, filename);
  fs.writeFileSync(outPath, encodePng(width, height, drawer));
  console.log(`Generated ${filename} (${width}x${height})`);
}
