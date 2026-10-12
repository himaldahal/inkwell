// Extra pen brushes. A stroke keeps tool:'pen' (so other modules still render it) plus brush:'<id>'.
export const BRUSHES = [
  ['fine', 'Fine'], ['ballpoint', 'Ballpoint'], ['fountain', 'Fountain'], ['brush', 'Brush'], ['marker', 'Marker'],
  ['calligraphy', 'Calligraphy'], ['airbrush', 'Airbrush'], ['neon', 'Neon'], ['dashed', 'Dashed'], ['rainbow', 'Rainbow'],
];
export const FONTS = [
  ['Sans', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'], ['Serif', 'Georgia, "Times New Roman", serif'],
  ['Mono', 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'], ['Rounded', '"Trebuchet MS", "Segoe UI", sans-serif'],
  ['Book', '"Palatino Linotype", Palatino, "Book Antiqua", serif'], ['Garamond', 'Garamond, "Times New Roman", serif'],
  ['Helvetica', 'Helvetica, Arial, sans-serif'], ['Verdana', 'Verdana, Geneva, sans-serif'], ['Impact', 'Impact, "Arial Black", sans-serif'],
  ['Marker', '"Marker Felt", "Comic Sans MS", cursive'], ['Hand', '"Segoe Print", "Bradley Hand", "Chalkboard SE", cursive'],
  ['Typewriter', '"Courier New", Courier, monospace'],
];

/** draw segment k (quadratic through midpoints) of a brush stroke */
export function drawBrushSeg(ctx, s, k, base) {
  const p = s.pts, n = p.length / 3, cx = p[k * 3], cy = p[k * 3 + 1], pr = p[k * 3 + 2];
  const ax = k === 0 ? cx : (p[k * 3 - 3] + cx) / 2, ay = k === 0 ? cy : (p[k * 3 - 2] + cy) / 2;
  const bx = k === n - 1 ? cx : (cx + p[k * 3 + 3]) / 2, by = k === n - 1 ? cy : (cy + p[k * 3 + 4]) / 2;
  const z = s.size; let w = z, alpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.color; ctx.shadowBlur = 0;
  switch (s.brush) {
    case 'ballpoint': w = z * (0.8 + 0.3 * pr); break;
    case 'fountain': w = z * (0.35 + 1.5 * pr * pr); break;
    case 'brush': { const t = Math.min(k, n - 1 - k) / Math.max(4, n * 0.2); w = z * (0.2 + 1.8 * pr * pr) * Math.min(1, 0.25 + t); break; }
    case 'marker': w = z * 1.4; alpha = 0.85; ctx.lineCap = 'square'; break;
    case 'calligraphy': { const a = Math.atan2(by - ay, bx - ax); w = z * (0.25 + 1.6 * Math.abs(Math.sin(a - 0.8))); break; }
    case 'airbrush': w = z * 1.6; alpha = 0.18; ctx.shadowColor = s.color; ctx.shadowBlur = z * 1.5; break;
    case 'neon': ctx.shadowColor = s.color; ctx.shadowBlur = z * 3; w = z; break;
    case 'dashed': ctx.setLineDash([z * 2, z * 2.6]); break;
    case 'rainbow': ctx.strokeStyle = `hsl(${(k * 9) % 360},85%,55%)`; break;
    default: return base(ctx, s, k);
  }
  ctx.globalAlpha = alpha; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
  if (s.brush === 'neon') { ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = w * 0.35; ctx.globalAlpha = .9; ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
