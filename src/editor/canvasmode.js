// Free canvas mode: an unbounded board with a camera (pan + zoom). Helpers shared by the page view, engine, minimap and export.
import { bboxOf } from './stroke.js';

export const CAM_MIN = 0.05, CAM_MAX = 8;
export const isCanvasNote = (note) => note?.mode === 'canvas';

/** union of every live stroke and item, or null when the board is empty */
export function contentBounds(page) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of page.strokes || []) {
    if (s.deleted || !s.pts?.length) continue;
    const b = bboxOf(s);
    if (b.x0 < x0) x0 = b.x0; if (b.y0 < y0) y0 = b.y0; if (b.x1 > x1) x1 = b.x1; if (b.y1 > y1) y1 = b.y1;
  }
  for (const it of page.items || []) {
    if (it.deleted) continue;
    const hh = it.h || 40;
    if (it.x < x0) x0 = it.x; if (it.y < y0) y0 = it.y; if (it.x + it.w > x1) x1 = it.x + it.w; if (it.y + hh > y1) y1 = it.y + hh;
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** a plain, origin-anchored copy of a canvas page, used by thumbnails, previews and PDF export */
export function flattenCanvas(page) {
  if (!page?.canvas) return page;
  const pad = 64, b = contentBounds(page) || { x0: 0, y0: 0, x1: 1000, y1: 700 };
  const ox = b.x0 - pad, oy = b.y0 - pad;
  const width = Math.max(480, Math.ceil(b.x1 - b.x0 + pad * 2)), height = Math.max(360, Math.ceil(b.y1 - b.y0 + pad * 2));
  const strokes = (page.strokes || []).filter((s) => !s.deleted).map((s) => {
    const pts = s.pts.slice(); for (let i = 0; i < pts.length; i += 3) { pts[i] -= ox; pts[i + 1] -= oy; }
    return { ...s, pts };
  });
  const items = (page.items || []).filter((i) => !i.deleted).map((i) => ({ ...i, x: i.x - ox, y: i.y - oy }));
  return { ...page, canvas: false, width, height, strokes, items, bg: page.bg || 'dot' };
}

const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
  const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** paint the infinite background for the visible world rect [x, y, x + w, y + h]; ctx already carries the camera transform */
export function drawCanvasBg(ctx, { x, y, w, h, z, paper, tpl }) {
  const grad = Array.isArray(paper) ? paper : null, base = (grad ? grad[0] : paper) || '#ffffff';
  ctx.fillStyle = base; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  if (!tpl || tpl === 'blank') return;
  const dark = lum(base) < 0.45;
  let step = tpl === 'lined' ? 32 : 24;
  while (step * z < 9) step *= 2; // keep the pattern calm when zoomed far out
  const x0 = Math.floor(x / step) * step, y0 = Math.floor(y / step) * step, px = 1 / z;
  if (tpl === 'dot') {
    ctx.fillStyle = dark ? 'rgba(255,255,255,.26)' : 'rgba(30,41,90,.26)';
    const r = Math.max(1.1 * px, 1.35 / z);
    for (let gx = x0; gx <= x + w; gx += step) for (let gy = y0; gy <= y + h; gy += step) ctx.fillRect(gx - r / 2, gy - r / 2, r * 1.6, r * 1.6);
    return;
  }
  ctx.lineWidth = px; ctx.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(30,41,90,.13)';
  ctx.beginPath();
  for (let gy = y0; gy <= y + h; gy += step) { ctx.moveTo(x - 2, gy); ctx.lineTo(x + w + 2, gy); }
  if (tpl === 'grid') for (let gx = x0; gx <= x + w; gx += step) { ctx.moveTo(gx, y - 2); ctx.lineTo(gx, y + h + 2); }
  ctx.stroke();
}
