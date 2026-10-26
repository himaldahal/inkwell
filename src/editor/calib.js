// Pen / touch calibration maths: pressure range, input jitter -> suggested smoothing, device summary.
export const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))] : 0);
export const median = (arr) => quantile(arr.slice().sort((a, b) => a - b), 0.5);

/** typical sample-to-sample wobble (px) over slow movement; null when there is not enough slow movement to judge */
export function jitterOf(xy) {
  const d2 = [];
  for (let i = 6; i < xy.length; i += 3) {
    const x0 = xy[i - 6], y0 = xy[i - 5], x1 = xy[i - 3], y1 = xy[i - 2], x2 = xy[i], y2 = xy[i + 1];
    const sp = Math.hypot(x2 - x0, y2 - y0) / 2;
    if (sp < 0.15 || sp > 3.2) continue;
    d2.push(Math.hypot(x2 - 2 * x1 + x0, y2 - 2 * y1 + y0));
  }
  return d2.length >= 10 ? median(d2) : null;
}
/** wobble -> smoothing % (clean pens need little, shaky fingers and mice need more) */
export const smoothFromJitter = (j) => Math.round(Math.min(85, Math.max(10, 10 + j * 55)));
export const DEVICE_NAME = { pen: 'Pen / Apple Pencil', touch: 'Finger', mouse: 'Mouse or trackpad' };

/** strokes: [{ type, xy: [x,y,t,...] flat screen px + ms, ps: [pressure...] }] */
export function summarize(strokes) {
  const types = {}; for (const s of strokes) types[s.type] = (types[s.type] || 0) + 1;
  const type = Object.keys(types).sort((a, b) => types[b] - types[a])[0] || 'mouse';
  const mine = strokes.filter((s) => s.type === type);
  const ps = mine.flatMap((s) => s.ps).filter((p) => p > 0).sort((a, b) => a - b);
  const lo = quantile(ps, 0.04), hi = quantile(ps, 0.96), hasPressure = type === 'pen' && hi - lo > 0.1;
  const js = mine.map((s) => jitterOf(s.xy)).filter((j) => j != null);
  const jitter = js.length ? median(js) : null;
  let events = 0, ms = 0; for (const s of mine) { events += s.xy.length / 3; ms += s.xy[s.xy.length - 1] - s.xy[2]; }
  return { type, hasPressure, pmin: hasPressure ? +lo.toFixed(3) : 0, pmax: hasPressure ? +hi.toFixed(3) : 1, jitter: jitter == null ? null : +jitter.toFixed(3), smooth: jitter == null ? null : smoothFromJitter(jitter), rate: ms > 0 ? Math.round((events / ms) * 1000) : null, strokes: mine.length };
}
