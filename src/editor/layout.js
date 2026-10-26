// Switching a note between page breaks (separate pages) and seamless scrolling (one continuous sheet).
import { newId } from '../core/utils.js';
import { alive } from './stroke.js';
import { contentBounds, pageH } from './canvasmode.js';

/** merge draw pages top to bottom into one seamless sheet; returns null when the note has PDF pages */
export function toSeamless(note) {
  const pages = note.pages || [];
  if (!pages.length || pages.some((p) => p.type !== 'draw' || p.infinite)) return null;
  const W = pages[0].width, H = Math.max(...pages.map((p) => p.height)), t = Date.now();
  const strokes = [], items = [];
  pages.forEach((p, i) => {
    const off = i * H;
    for (const s of alive(p.strokes)) { const pts = s.pts.slice(); for (let k = 1; k < pts.length; k += 3) pts[k] += off; strokes.push({ ...s, pts, u: t }); }
    for (const it of alive(p.items)) items.push({ ...it, y: it.y + off, u: t });
  });
  const first = pages[0], keep = {};
  for (const k of ['bg', 'paper', 'paperGrad', 'pattern']) if (first[k] !== undefined) keep[k] = first[k];
  return [{ id: newId(), type: 'draw', width: W, height: H * pages.length, pageH: H, canvas: true, seamless: true, strokes, items, ...keep }];
}

/** cut a seamless sheet into separate pages at its breaks (each stroke / item goes to the page it starts on) */
export function toPaged(page) {
  const H = pageH(page), b = contentBounds(page), n = Math.max(1, Math.ceil((b ? b.y1 : 0) / H)), t = Date.now();
  const out = Array.from({ length: n }, () => ({ id: newId(), type: 'draw', width: page.width, height: H, bg: page.bg, paper: page.paper, paperGrad: page.paperGrad, pattern: page.pattern, strokes: [], items: [] }));
  for (const k of ['bg', 'paper', 'paperGrad', 'pattern']) for (const p of out) if (p[k] === undefined) delete p[k];
  const at = (y) => Math.min(n - 1, Math.max(0, Math.floor(y / H)));
  for (const s of alive(page.strokes)) {
    const i = at(s.pts[1]), pts = s.pts.slice(); for (let k = 1; k < pts.length; k += 3) pts[k] -= i * H;
    out[i].strokes.push({ ...s, pts, u: t });
  }
  for (const it of alive(page.items)) { const i = at(it.y + (it.h || 40) / 2); out[i].items.push({ ...it, y: it.y - i * H, u: t }); }
  return out;
}
