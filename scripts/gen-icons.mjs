// Generates Inkwell app icons (PNG + SVG) using only Node built-ins.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(join(root, 'icons'), { recursive: true });

// ---- geometry in a 512x512 design space ----
const rot = (pts, deg, cx = 256, cy = 270) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};
const ANGLE = 25;
const nib = rot([[232, 104], [280, 104], [334, 246], [256, 420], [178, 246]], ANGLE);
const slit = rot([[252.5, 284], [259.5, 284], [258, 424], [254, 424]], ANGLE);
const holeC = rot([[256, 262]], ANGLE)[0], holeR = 19;
const stroke = { a: [150, 452], b: [352, 452], r: 9 };
const C1 = [129, 140, 248], C2 = [55, 48, 163]; // indigo 400 -> 800

const inPoly = (pts, x, y) => {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
};
const inCapsule = (x, y) => {
  const { a, b, r } = stroke, dx = b[0] - a[0], t = Math.max(0, Math.min(1, ((x - a[0]) * dx) / (dx * dx)));
  return Math.hypot(x - (a[0] + t * dx), y - a[1]) <= r;
};
const glyphAt = (x, y) =>
  (inPoly(nib, x, y) && !inPoly(slit, x, y) && Math.hypot(x - holeC[0], y - holeC[1]) > holeR) || inCapsule(x, y);
const inRounded = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
  return Math.hypot(x - cx, y - cy) <= r;
};

function render(size, { rounded = true, glyphScale = 1 }) {
  const px = Buffer.alloc(size * size * 4), SS = 3, k = 512 / size;
  for (let py = 0; py < size; py++) for (let pxx = 0; pxx < size; pxx++) {
    let bg = 0, gl = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (pxx + (sx + 0.5) / SS) * k, y = (py + (sy + 0.5) / SS) * k;
      if (!rounded || inRounded(x, y, 112)) bg++;
      const gx = (x - 256) / glyphScale + 256, gy = (y - 256) / glyphScale + 256;
      if (glyphAt(gx, gy)) gl++;
    }
    const n = SS * SS, a = bg / n, g = gl / n;
    const t = Math.min(1, Math.max(0, ((pxx + py) / (2 * size)) * 1.1));
    const col = C1.map((c, i) => c + (C2[i] - c) * t);
    const i = (py * size + pxx) * 4;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(col[c] * (1 - g) + 255 * g);
    px[i + 3] = Math.round(255 * a);
  }
  return px;
}

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = (name, size, opts) => { writeFileSync(join(root, 'icons', name), png(size, render(size, opts))); console.log('wrote', name); };
out('icon-192.png', 192, {});
out('icon-512.png', 512, {});
out('maskable-512.png', 512, { rounded: false, glyphScale: 0.72 });
out('apple-touch-icon.png', 180, { rounded: false, glyphScale: 0.86 });
out('favicon-32.png', 32, {});

const pts = (p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${C1})"/><stop offset="1" stop-color="rgb(${C2})"/></linearGradient>
<mask id="m"><rect width="512" height="512" fill="#fff"/><polygon points="${pts(slit)}" fill="#000"/><circle cx="${holeC[0].toFixed(1)}" cy="${holeC[1].toFixed(1)}" r="${holeR}" fill="#000"/></mask></defs>
<rect width="512" height="512" rx="112" fill="url(#g)"/>
<g fill="#fff"><polygon points="${pts(nib)}" mask="url(#m)"/><line x1="${stroke.a[0]}" y1="${stroke.a[1]}" x2="${stroke.b[0]}" y2="${stroke.b[1]}" stroke="#fff" stroke-width="${stroke.r * 2}" stroke-linecap="round"/></g>
</svg>
`;
writeFileSync(join(root, 'favicon.svg'), svg);
writeFileSync(join(root, 'icons', 'icon.svg'), svg);
console.log('wrote favicon.svg');
