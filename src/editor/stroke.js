// Stroke model helpers: rendering, geometry, hit testing, shape recognition.
// pts is a flat array [x,y,pressure, x,y,pressure, ...] in page units.
import { newId } from '../core/utils.js';
import { drawBrushSeg } from './brushes.js';
import { buildShape, CLOSED } from './shapes.js';

export const HL_ALPHA = 0.42;
export const widthFor = (tool, size, p) =>
  tool === 'highlighter' ? size : tool === 'pencil' ? size * (0.6 + 0.8 * p) : size * (0.3 + 1.4 * p);

const rnd = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const seedOf = (s) => { let a = 0; const id = s.id || ''; for (let i = 0; i < id.length; i++) a = (a * 31 + id.charCodeAt(i)) | 0; return a % 9973; };

/** Draw one smoothed segment (quadratic through midpoints) of a pen/pencil stroke. */
export function drawSegment(ctx, s, k) {
  if (s.brush && s.brush !== 'fine' && !s.shape) return drawBrushSeg(ctx, s, k, plainSegment);
  plainSegment(ctx, s, k);
}
function plainSegment(ctx, s, k) {
  const pts = s.pts, n = pts.length / 3;
  const cx = pts[k * 3], cy = pts[k * 3 + 1];
  const ax = k === 0 ? cx : (pts[k * 3 - 3] + cx) / 2, ay = k === 0 ? cy : (pts[k * 3 - 2] + cy) / 2;
  const bx = k === n - 1 ? cx : (cx + pts[k * 3 + 3]) / 2, by = k === n - 1 ? cy : (cy + pts[k * 3 + 4]) / 2;
  const w = widthFor(s.tool, s.size, pts[k * 3 + 2]);
  ctx.strokeStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.tool === 'pencil') {
    const seed = seedOf(s) + k * 7;
    ctx.globalAlpha = 0.5; ctx.lineWidth = w * 0.9;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
    ctx.globalAlpha = 0.28; ctx.lineWidth = w * 0.45;
    for (let j = 0; j < 2; j++) {
      const ox = (rnd(seed + j * 3.1) - 0.5) * w * 0.7, oy = (rnd(seed + j * 5.3 + 1) - 0.5) * w * 0.7;
      ctx.beginPath(); ctx.moveTo(ax + ox, ay + oy); ctx.quadraticCurveTo(cx + ox, cy + oy, bx + ox, by + oy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
  }
}
export function drawDot(ctx, s) {
  const w = widthFor(s.tool, s.size, s.pts[2]);
  ctx.fillStyle = s.color; ctx.globalAlpha = (s.tool === 'pencil' ? 0.6 : s.tool === 'highlighter' ? HL_ALPHA : 1) * (s.alpha ?? 1);
  ctx.beginPath(); ctx.arc(s.pts[0], s.pts[1], w / 2, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
}
/** whole-path drawing (highlighter, shapes): one stroke() so alpha never double-darkens */
export function drawPath(ctx, s) {
  const pts = s.pts, n = pts.length / 3;
  if (n === 1) return drawDot(ctx, s);
  ctx.strokeStyle = s.color; ctx.lineCap = s.chisel ? 'butt' : 'round'; ctx.lineJoin = s.chisel ? 'bevel' : 'round';
  ctx.lineWidth = s.size;
  ctx.globalAlpha = (s.tool === 'highlighter' ? HL_ALPHA : s.tool === 'pencil' ? 0.7 : 1) * (s.alpha ?? 1);
  if (s.dash) ctx.setLineDash([s.size * 2.2, s.size * 2.2]);
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  if (s.shape) for (let i = 1; i < n; i++) (pts[i * 3 + 2] < 0 ? ctx.moveTo(pts[i * 3], pts[i * 3 + 1]) : ctx.lineTo(pts[i * 3], pts[i * 3 + 1]));
  else {
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(pts[i * 3], pts[i * 3 + 1], (pts[i * 3] + pts[i * 3 + 3]) / 2, (pts[i * 3 + 1] + pts[i * 3 + 4]) / 2);
    ctx.lineTo(pts[n * 3 - 3], pts[n * 3 - 2]);
  }
  if (s.fill && CLOSED.has(s.shape)) { ctx.fillStyle = s.fill; ctx.fill(); }
  ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
}
export function drawStroke(ctx, s) {
  const n = s.pts.length / 3; if (!n) return;
  if (n === 1) return drawDot(ctx, s);
  if (s.tool === 'highlighter' || s.shape || (s.alpha != null && s.alpha < 1 && s.tool !== 'pencil')) return drawPath(ctx, s);
  for (let k = 0; k < n; k++) drawSegment(ctx, s, k);
}

// ---- geometry ------------------------------------------------------------
const bbCache = new WeakMap();
export function bboxOf(s) {
  let b = bbCache.get(s); if (b) return b;
  const p = s.pts; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
  const pad = (s.size || 2) * 0.9 + 1;
  b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  bbCache.set(s, b); return b;
}
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
let AUTHOR = 'me';
export const setAuthor = (a) => { AUTHOR = a || 'me'; };
export const getAuthor = () => AUTHOR;
export const tomb = (s) => (s.deleted ? s : { by: s.by, delBy: AUTHOR, id: s.id, tool: s.tool, color: s.color, size: s.size, type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, pts: s.pts ? [] : undefined, deleted: true, u: Date.now() });
export const alive = (arr) => arr.filter((x) => !x.deleted);
export function strokeHit(s, x, y, r) {
  if (s.deleted || !s.pts.length) return false;
  const b = bboxOf(s); if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const p = s.pts, lim = r + (s.size || 2) / 2;
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= lim;
  for (let i = 0; i < p.length - 3; i += 3) if (p[i + 5] >= 0 && distSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= lim) return true;
  return false;
}
export function polyContains(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function xformStroke(s, f, sizeK = 1) {
  const p = s.pts, o = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) { const r = f(p[i], p[i + 1]); o[i] = r[0]; o[i + 1] = r[1]; o[i + 2] = p[i + 2]; }
  return { ...s, size: s.size * sizeK, pts: o, u: Date.now() };
}
export const cloneStroke = (s, over = {}) => ({ ...s, id: newId(), pts: s.pts.slice(), ...over });

/** Remove the part of stroke inside circle (cx,cy,r). Returns null if untouched, else array of remaining pieces. */
export function eraseFromStroke(s, cx, cy, r) {
  if (s.deleted || !s.pts.length) return null;
  const b = bboxOf(s); if (cx < b.x0 - r || cx > b.x1 + r || cy < b.y0 - r || cy > b.y1 + r) return null;
  const p = s.pts, n = p.length / 3, step = Math.max(r / 2, 1.5);
  const d = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && p[i * 3 + 2] >= 0) {
      const ax = p[i * 3 - 3], ay = p[i * 3 - 2], bx = p[i * 3], by = p[i * 3 + 1], L = Math.hypot(bx - ax, by - ay);
      const m = Math.floor(L / step);
      for (let j = 1; j <= m; j++) { const t = j / (m + 1); d.push([ax + (bx - ax) * t, ay + (by - ay) * t, p[i * 3 - 1] + (p[i * 3 + 2] - p[i * 3 - 1]) * t]); }
    }
    d.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
  }
  const lim = r + (s.size || 2) * 0.25;
  let hit = false; const pieces = []; let cur = [];
  for (const q of d) {
    if (Math.hypot(q[0] - cx, q[1] - cy) <= lim) { hit = true; if (cur.length) pieces.push(cur); cur = []; } else cur.push(q);
  }
  if (!hit) return null;
  if (cur.length) pieces.push(cur);
  return pieces.map((pc) => ({ ...s, id: newId(), pts: pc.flat() }));
}

// ---- shapes ----------------------------------------------------------------
export function shapePts(kind, x1, y1, x2, y2, pr = 0.5) {
  const o = [];
  const add = (x, y) => o.push(x, y, pr);
  if (kind === 'line') { add(x1, y1); add(x2, y2); }
  else if (kind === 'rect') { add(x1, y1); add(x2, y1); add(x2, y2); add(x1, y2); add(x1, y1); }
  else if (kind === 'triangle') { add((x1 + x2) / 2, y1); add(x2, y2); add(x1, y2); add((x1 + x2) / 2, y1); }
  else if (kind === 'ellipse') {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * 6.28319; add(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  } else if (kind !== 'arrow') {
    return buildShape(kind, x1, y1, x2, y2);
  } else if (kind === 'arrow') {
    const a = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1), hl = Math.min(44, Math.max(14, L * 0.22));
    add(x1, y1); add(x2, y2);
    add(x2 - hl * Math.cos(a - 0.5), y2 - hl * Math.sin(a - 0.5)); add(x2, y2);
    add(x2 - hl * Math.cos(a + 0.5), y2 - hl * Math.sin(a + 0.5));
  }
  return o;
}
function dpSimplify(P, eps) {
  if (P.length < 3) return P;
  let md = 0, mi = 0; const a = P[0], b = P[P.length - 1];
  for (let i = 1; i < P.length - 1; i++) { const d = distSeg(P[i][0], P[i][1], a[0], a[1], b[0], b[1]); if (d > md) { md = d; mi = i; } }
  if (md > eps) return [...dpSimplify(P.slice(0, mi + 1), eps).slice(0, -1), ...dpSimplify(P.slice(mi), eps)];
  return [a, b];
}
/** Try to recognise a hand-drawn line / ellipse / triangle / rectangle. Returns {kind, pts} (flat pts) or null. */
export function recognizeShape(pts) {
  const P = []; for (let i = 0; i < pts.length; i += 3) P.push([pts[i], pts[i + 1]]);
  if (P.length < 5) return null;
  let L = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < P.length; i++) {
    if (i) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    x0 = Math.min(x0, P[i][0]); x1 = Math.max(x1, P[i][0]); y0 = Math.min(y0, P[i][1]); y1 = Math.max(y1, P[i][1]);
  }
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
  if (diag < 12) return null;
  const a = P[0], b = P[P.length - 1], chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let dev = 0; for (const q of P) dev = Math.max(dev, distSeg(q[0], q[1], a[0], a[1], b[0], b[1]));
  if (chord > diag * 0.6 && dev < Math.max(5, chord * 0.06)) return { kind: 'line', pts: shapePts('line', a[0], a[1], b[0], b[1]) };
  if (chord > diag * 0.3) return null; // not closed
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w > 10 && h > 10) {
    let m = 0, m2 = 0;
    const rs = P.map((q) => Math.hypot((q[0] - cx) / (w / 2), (q[1] - cy) / (h / 2))); rs.forEach((r) => { m += r; });
    m /= rs.length; rs.forEach((r) => { m2 += (r - m) ** 2; });
    if (Math.sqrt(m2 / rs.length) < 0.1 && m > 0.85 && m < 1.15) return { kind: 'ellipse', pts: shapePts('ellipse', x0, y0, x1, y1) };
  }
  const closed = [...P, P[0]];
  const poly = dpSimplify(closed, diag * 0.07);
  const v = poly.slice(0, -1);
  if (v.length === 3) { const q = [...v, v[0]]; return { kind: 'triangle', pts: q.flatMap(([x, y]) => [x, y, 0.5]) }; }
  if (v.length === 4) {
    const ang = (i) => {
      const p0 = v[(i + 3) % 4], p1 = v[i], p2 = v[(i + 1) % 4];
      const a1 = Math.atan2(p0[1] - p1[1], p0[0] - p1[0]), a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      return Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    };
    if ([0, 1, 2, 3].every((i) => Math.abs(ang(i) - Math.PI / 2) < 0.4)) {
      // snap to axis aligned when nearly so
      const tilt = Math.atan2(v[1][1] - v[0][1], v[1][0] - v[0][0]);
      const q = Math.abs(tilt) < 0.12 || Math.abs(Math.abs(tilt) - Math.PI) < 0.12 || Math.abs(Math.abs(tilt) - Math.PI / 2) < 0.12
        ? null : [...v, v[0]];
      if (!q) return { kind: 'rect', pts: shapePts('rect', x0, y0, x1, y1) };
      return { kind: 'rect', pts: q.flatMap(([x, y]) => [x, y, 0.5]) };
    }
  }
  return null;
}
