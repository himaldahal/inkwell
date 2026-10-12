// Arrow/line connectors that bind to shapes and follow them when they move.
import { bboxOf, shapePts } from './stroke.js';
import { CLOSED } from './shapes.js';

const isTarget = (s) => !s.deleted && s.shape && CLOSED.has(s.shape);
export const isConnector = (s) => !s.deleted && s.bind && /^(line|arrow|darrow)$/.test(s.shape || '');
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
function edge(b, tx, ty) {
  const [cx, cy] = center(b), dx = tx - cx, dy = ty - cy, hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
  if (!dx && !dy) return [cx, cy];
  const k = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return [cx + dx * k, cy + dy * k];
}
/** topmost closed shape under (x,y) */
export function targetAt(strokes, x, y, pad = 6) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]; if (!isTarget(s)) continue;
    const b = bboxOf(s); if (x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad) return s;
  }
  return null;
}
export function connect(kind, A, B, p1, p2) {
  let [x1, y1] = p1, [x2, y2] = p2;
  const ba = A && bboxOf(A), bb = B && bboxOf(B);
  if (ba) [x1, y1] = edge(ba, bb ? center(bb)[0] : x2, bb ? center(bb)[1] : y2);
  if (bb) [x2, y2] = edge(bb, ba ? center(ba)[0] : x1, ba ? center(ba)[1] : y1);
  return { pts: shapePts(kind, x1, y1, x2, y2), ends: [[x1, y1], [x2, y2]] };
}
/** recompute bound connectors; returns {list, updated:[stroke]} (list === input when nothing changed) */
export function fixBindings(strokes) {
  if (!strokes.some(isConnector)) return { list: strokes, updated: [] };
  const by = new Map(strokes.filter((s) => !s.deleted).map((s) => [s.id, s]));
  const updated = [], list = strokes.map((s) => {
    if (!isConnector(s)) return s;
    const A = by.get(s.bind.a), B = by.get(s.bind.b); if (!A && !B) return s;
    const p = s.pts, n = p.length / 3;
    const first = [p[0], p[1]], last = [p[(n - 1) * 3] , p[(n - 1) * 3 + 1]];
    // arrows store tip at the first return point; recover endpoints from the 2nd point
    const tip = s.shape === 'line' ? [p[3], p[4]] : [p[3], p[4]];
    void last;
    const r = connect(s.shape, A, B, first, tip);
    if (r.pts.every((v, i) => Math.abs(v - p[i]) < 0.01)) return s;
    const ns = { ...s, pts: r.pts, u: Date.now() }; updated.push(ns); return ns;
  });
  return updated.length ? { list, updated } : { list: strokes, updated: [] };
}
