// Text transformations (typed notes), and ink/object transformations for the selection.
import { h } from '../core/utils.js';
import { popover, menu } from './ui.js';
import { recognizeShape, xformStroke, bboxOf } from './stroke.js';
import { toast } from '../core/store.js';

// ---------- text ----------
const title = (s) => s.toLowerCase().replace(/(^|[\s\-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const sentence = (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
export const CASES = { upper: (s) => s.toUpperCase(), lower: (s) => s.toLowerCase(), title, sentence };

function textNodes(root, range) {
  const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) if (!range || range.intersectsNode(n)) out.push(n);
  return out;
}
function selRange(root) { const s = getSelection(); return s.rangeCount && !s.isCollapsed && root.contains(s.anchorNode) ? s.getRangeAt(0) : null; }
export function mapText(root, fn) {
  const rg = selRange(root);
  for (const n of textNodes(root, rg)) {
    const a = rg && n === rg.startContainer ? rg.startOffset : 0, b = rg && n === rg.endContainer ? rg.endOffset : n.length;
    n.data = n.data.slice(0, a) + fn(n.data.slice(a, b)) + n.data.slice(b);
  }
}
function blocks(root) {
  const rg = selRange(root);
  const list = [...root.querySelectorAll(':scope > p, :scope > div, :scope > h1, :scope > h2, :scope > h3, li')].filter((b) => !rg || rg.intersectsNode(b));
  return list.length ? list : [...root.children];
}
export function sortLines(root, desc) {
  const bl = blocks(root); if (bl.length < 2) return;
  const parent = bl[0].parentNode; if (!bl.every((b) => b.parentNode === parent)) { toast('Select lines in one list or paragraphs'); return; }
  const sorted = [...bl].sort((a, b) => a.textContent.localeCompare(b.textContent, undefined, { numeric: true }) * (desc ? -1 : 1));
  const anchor = bl[bl.length - 1].nextSibling; bl.forEach((b) => b.remove()); sorted.forEach((b) => parent.insertBefore(b, anchor));
}
export function convertList(root, to) {
  const s = getSelection(); const n = s.anchorNode; const list = (n?.nodeType === 3 ? n.parentElement : n)?.closest?.('ul,ol');
  if (!list || !root.contains(list)) { document.execCommand(to === 'ol' ? 'insertOrderedList' : 'insertUnorderedList'); return; }
  const nl = document.createElement(to === 'ol' ? 'ol' : 'ul'); if (to === 'check') nl.className = 'ik-check';
  while (list.firstChild) nl.append(list.firstChild); list.replaceWith(nl);
}
export function findReplace(root, find, rep, cs) {
  if (!find) return 0; let c = 0; const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi');
  for (const n of textNodes(root)) { const d = n.data.replace(re, () => { c++; return rep; }); if (d !== n.data) n.data = d; }
  return c;
}
export function textMenu(anchor, root, changed) {
  const run = (fn) => () => { root.focus(); fn(); changed(); };
  const fr = () => {
    const f = h('input', { type: 'text', placeholder: 'Find', 'aria-label': 'Find' }), r = h('input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with' });
    const cs = h('label', { class: 'ik-check-l' }, h('input', { type: 'checkbox' }), 'Match case');
    const go = h('button', { type: 'button', class: 'ik-primary', onclick: () => { const c = findReplace(root, f.value, r.value, cs.firstChild.checked); changed(); toast(c + ' replaced'); } }, 'Replace all');
    popover(anchor, h('div', { class: 'ik-tagbox' }, h('div', { class: 'ik-menu-title' }, 'Find & replace'), f, r, cs, go), { align: 'end' }); setTimeout(() => f.focus(), 0);
  };
  menu(anchor, [
    { title: 'Case' }, { label: 'UPPERCASE', run: run(() => mapText(root, CASES.upper)) }, { label: 'lowercase', run: run(() => mapText(root, CASES.lower)) },
    { label: 'Title Case', run: run(() => mapText(root, CASES.title)) }, { label: 'Sentence case', run: run(() => mapText(root, CASES.sentence)) },
    { title: 'Lists' }, { label: 'To bullets', icon: 'list', run: run(() => convertList(root, 'ul')) }, { label: 'To numbered', icon: 'olist', run: run(() => convertList(root, 'ol')) },
    { label: 'To checklist', icon: 'checklist', run: run(() => convertList(root, 'check')) },
    { title: 'Format' }, { label: 'Indent', run: run(() => document.execCommand('indent')) }, { label: 'Outdent', run: run(() => document.execCommand('outdent')) },
    { label: 'Clear formatting', run: run(() => document.execCommand('removeFormat')) },
    { label: 'Sort lines A-Z', run: run(() => sortLines(root)) }, { label: 'Sort lines Z-A', run: run(() => sortLines(root, true)) },
    { label: 'Find & replace...', icon: 'search', run: () => setTimeout(fr, 0) },
  ], { align: 'end' });
}

// ---------- ink ----------
const smoothPts = (p) => {
  const n = p.length / 3; if (n < 4) return p; const o = p.slice();
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < n - 1; i++) for (const k of [0, 1]) o[i * 3 + k] = (o[i * 3 - 3 + k] + 2 * o[i * 3 + k] + o[i * 3 + 3 + k]) / 4;
  return o;
};
const dist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const simplifyPts = (p, eps = 1) => {
  const n = p.length / 3, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const rec = (a, b) => { let m = 0, mi = -1; for (let i = a + 1; i < b; i++) { const d = dist(p[i * 3], p[i * 3 + 1], p[a * 3], p[a * 3 + 1], p[b * 3], p[b * 3 + 1]); if (d > m) { m = d; mi = i; } } if (m > eps && mi > 0) { keep[mi] = 1; rec(a, mi); rec(mi, b); } };
  rec(0, n - 1); const o = []; for (let i = 0; i < n; i++) if (keep[i]) o.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); return o;
};
export const INK_OPS = {
  smooth: (s) => ({ ...s, pts: smoothPts(s.pts) }),
  simplify: (s) => ({ ...s, pts: simplifyPts(s.pts, 1.2) }),
  straighten: (s) => { const p = s.pts, n = p.length / 3; return n < 2 ? s : { ...s, shape: 'line', pts: [p[0], p[1], 0.5, p[n * 3 - 3], p[n * 3 - 2], 0.5] }; },
  toShape: (s) => { const r = recognizeShape(s.pts); return r ? { ...s, shape: r.kind, pts: r.pts } : s; },
  thicker: (s) => ({ ...s, size: Math.min(60, s.size * 1.25) }), thinner: (s) => ({ ...s, size: Math.max(0.4, s.size * 0.8) }),
};
export function inkOp(engine, name) {
  const f = INK_OPS[name]; engine.tools.select.mutate((s) => (s.pts ? f(s) : s), (i) => i);
}
export function inspector(anchor, engine) {
  const sel = engine.tools.select, s = engine.selection; if (!s) return;
  const pv = s.pv, strokes = pv.page.strokes.filter((x) => !x.deleted && s.strokes.has(x.id)), items = pv.page.items.filter((x) => !x.deleted && s.items.has(x.id));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const st of strokes) { const b = bboxOf(st); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  for (const i of items) { x0 = Math.min(x0, i.x); y0 = Math.min(y0, i.y); x1 = Math.max(x1, i.x + i.w); y1 = Math.max(y1, i.y + i.h); }
  const v = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, a: items.length === 1 && !strokes.length ? items[0].rotation || 0 : 0 };
  const field = (k, label) => { const i = h('input', { type: 'number', value: Math.round(v[k] * 10) / 10, step: 1, 'aria-label': label, class: 'ik-hex', style: { width: '78px' } }); i.addEventListener('change', () => apply(k, +i.value)); return h('label', { class: 'ik-check-l' }, label, i); };
  function apply(k, val) {
    const o = { ...v }, nv = { ...v, [k]: val };
    if (k === 'a') { const d = ((nv.a - o.a) * Math.PI) / 180, cx = o.x + o.w / 2, cy = o.y + o.h / 2, co = Math.cos(d), si = Math.sin(d), rot = (x, y) => [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co];
      sel.mutate((st) => xformStroke(st, rot), (it) => { const [nx, ny] = rot(it.x + it.w / 2, it.y + it.h / 2); return { ...it, x: nx - it.w / 2, y: ny - it.h / 2, rotation: nv.a }; }); }
    else { const kx = o.w ? nv.w / o.w : 1, ky = o.h ? nv.h / o.h : 1;
      sel.mutate((st) => xformStroke(st, (x, y) => [nv.x + (x - o.x) * kx, nv.y + (y - o.y) * ky]), (it) => ({ ...it, x: nv.x + (it.x - o.x) * kx, y: nv.y + (it.y - o.y) * ky, w: it.w * kx, h: it.h * ky })); }
    Object.assign(v, nv);
  }
  popover(anchor, h('div', { class: 'ik-tagbox' }, h('div', { class: 'ik-menu-title' }, 'Inspector'), field('x', 'X'), field('y', 'Y'), field('w', 'Width'), field('h', 'Height'), field('a', 'Angle')), { align: 'end' });
}
