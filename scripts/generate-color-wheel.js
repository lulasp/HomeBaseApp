// Renders assets/color-wheel.png — the hue/saturation disc behind
// ColorWheel. Geometry must match wheelPointToHex in src/utils/color.js.
// Usage: node scripts/generate-color-wheel.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 480;
const R = SIZE / 2;

function hsvToRgb(h, s) {
  const c = s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - c;
  const [r, g, b] =
    h < 60  ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255));
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const dx = x + 0.5 - R;
    const dy = y + 0.5 - R;
    const dist = Math.hypot(dx, dy);
    let h = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (h < 0) h += 360;
    const [r, g, b] = hsvToRgb(h, Math.min(dist / R, 1));
    const alpha = Math.max(0, Math.min(1, R - dist)); // 1px anti-aliased edge
    const i = row + 1 + x * 4;
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = Math.round(alpha * 255);
  }
}

// PNG filter type 4 (Paeth) per row — smooth gradients compress far better.
function paethFilter(src) {
  const stride = SIZE * 4 + 1;
  const out = Buffer.alloc(src.length);
  for (let y = 0; y < SIZE; y++) {
    const row = y * stride;
    out[row] = 4;
    for (let i = 1; i < stride; i++) {
      const a = i > 4 ? src[row + i - 4] : 0;
      const b = y > 0 ? src[row - stride + i] : 0;
      const c = i > 4 && y > 0 ? src[row - stride + i - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[row + i] = (src[row + i] - pred) & 0xff;
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(paethFilter(raw), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'color-wheel.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
