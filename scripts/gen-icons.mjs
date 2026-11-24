// =============================================================================
// PrepSetu app icons — generated without external dependencies.
// Renders a geometric "bridge to success" mark on a gradient tile using a tiny
// anti-aliased rasteriser, then writes PNGs with Node's zlib.
// =============================================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

// ---- PNG encoder -----------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Shape helpers (normalised 0..1 coordinates) --------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

function roundedRect(x, y, left, top, right, bottom, radius) {
  const cx = clamp(x, left + radius, right - radius);
  const cy = clamp(y, top + radius, bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

function circle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) <= r;
}

/** Ring segment with a horizontal cut (upper half only) — the arch. */
function arch(x, y, cx, cy, rOuter, rInner) {
  if (y > cy) return false;
  const d = Math.hypot(x - cx, y - cy);
  return d <= rOuter && d >= rInner;
}

// ---- Render ----------------------------------------------------------------
function render(size, { maskable = false, monochrome = false } = {}) {
  const S = size;
  const rgba = Buffer.alloc(S * S * 4);
  const pad = maskable ? 0.18 : 0.1;
  const inner = 1 - pad * 2;

  // Brand gradient (indigo → violet), sampled diagonally.
  const c1 = { r: 79, g: 70, b: 229 }; // indigo-600
  const c2 = { r: 147, g: 51, b: 234 }; // purple-600
  const c3 = { r: 14, g: 165, b: 233 }; // sky-500 accent (bottom-left)

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      // 3x3 supersampling for smooth edges
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      const SS = 3;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / S;
          const y = (py + (sy + 0.5) / SS) / S;

          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;

          const inTile =
            maskable ||
            roundedRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.235);

          if (inTile) {
            const t = clamp((x + y) / 2, 0, 1);
            const base = {
              r: mix(mix(c3.r, c1.r, clamp(t * 1.6, 0, 1)), c2.r, clamp(t * 1.1, 0, 1)),
              g: mix(mix(c3.g, c1.g, clamp(t * 1.6, 0, 1)), c2.g, clamp(t * 1.1, 0, 1)),
              b: mix(mix(c3.b, c1.b, clamp(t * 1.6, 0, 1)), c2.b, clamp(t * 1.1, 0, 1)),
            };
            r = base.r;
            g = base.g;
            b = base.b;
            a = 255;

            if (monochrome) {
              r = 255;
              g = 255;
              b = 255;
            }

            // ---- white mark: a bridge (setu) — arch on two piers over a deck
            const deckY = 0.655;
            const archCx = 0.5;
            const archR = 0.275 * inner;
            const archThick = 0.055 * inner;
            const archCy = deckY - 0.045 * inner;
            const legX = archR - archThick / 2;       // piers sit under the arch centreline
            const legHalf = 0.026 * inner;
            const legTop = deckY - 0.085 * inner;
            const legBottom = deckY + 0.012;
            const deckHalf = archR + 0.045 * inner;
            const deckHalfH = 0.024 * inner;

            const onArch =
              y <= legTop &&
              y >= archCy - archR - 0.002 &&
              arch(x, y, archCx, archCy, archR, archR - archThick);

            const onPillar =
              y >= legTop &&
              y <= legBottom &&
              (Math.abs(x - (archCx - legX)) <= legHalf || Math.abs(x - (archCx + legX)) <= legHalf);

            const onDeck =
              x >= archCx - deckHalf &&
              x <= archCx + deckHalf &&
              y >= legBottom - 0.004 &&
              y <= legBottom - 0.004 + deckHalfH * 2;

            if (onArch || onPillar || onDeck) {
              r = 255;
              g = 255;
              b = 255;
            }
          }

          rSum += r;
          gSum += g;
          bSum += b;
          aSum += a;
        }
      }

      const samples = SS * SS;
      const idx = (py * S + px) * 4;
      const alpha = aSum / samples;
      if (alpha <= 0) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      } else {
        rgba[idx] = Math.round(rSum / samples);
        rgba[idx + 1] = Math.round(gSum / samples);
        rgba[idx + 2] = Math.round(bSum / samples);
        rgba[idx + 3] = Math.round(alpha);
      }
    }
  }
  return encodePng(S, S, rgba);
}

const targets = [
  { name: 'icon-72.png', size: 72 },
  { name: 'icon-96.png', size: 96 },
  { name: 'icon-128.png', size: 128 },
  { name: 'icon-144.png', size: 144 },
  { name: 'icon-152.png', size: 152 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-384.png', size: 384 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'maskable-512.png', size: 512, maskable: true },
  { name: 'badge-72.png', size: 72, monochrome: true },
  { name: 'favicon-32.png', size: 32 },
];

for (const t of targets) {
  writeFileSync(resolve(outDir, t.name), render(t.size, { maskable: t.maskable, monochrome: t.monochrome }));
  console.log(`✓ ${t.name} (${t.size}×${t.size})`);
}

// favicon.ico: a single 32px PNG is accepted by all modern browsers.
writeFileSync(resolve(root, 'public/favicon.png'), render(32));
console.log('✓ favicon.png');
