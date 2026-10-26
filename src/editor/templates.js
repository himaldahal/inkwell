// Paper templates, drawn in page units onto a 2D context.
import { drawLayout } from './layouts.js';
import { LAYOUTS } from './layoutdata.js';
export const TEMPLATES = [
  { id: 'blank', name: 'Blank' }, { id: 'lined', name: 'Lined' }, { id: 'grid', name: 'Grid' },
  { id: 'dot', name: 'Dot grid' }, { id: 'cornell', name: 'Cornell' }, { id: 'todo', name: 'To-do' },
];
export const PAPER_COLORS = [
  { c: null, name: 'White' }, { c: '#fdf6e3', name: 'Cream' }, { c: '#fff9c4', name: 'Yellow' },
  { c: '#e8f5e9', name: 'Mint' }, { c: '#e3f2fd', name: 'Sky' }, { c: '#fce4ec', name: 'Rose' },
  { c: '#212121', name: 'Charcoal' }, { c: '#0f172a', name: 'Midnight' },
];
const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
  const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
/** which layout preset a page shows: its own, else the note's when the page keeps the note's default paper */
export const presetOf = (note, page) => page.preset || (page.bg ? null : note.preset);
export const isDarkPaper = (paper) => lum(Array.isArray(paper) ? paper[0] : paper) < 0.45;
export const paperOf = (note, page) => (page.paperGrad ? page.paperGrad : page.paper !== undefined ? page.paper : note.paperColor);
export const patternOf = (note, page) => page.pattern || note.pattern || null;
export function drawTemplate(ctx, w, h, tpl = 'blank', paper, preset, pat) {
  const grad = Array.isArray(paper) ? paper : null;
  const bg = (grad ? grad[0] : paper) || '#ffffff';
  if (paper === 'none') ctx.clearRect(0, 0, w, h);
  else if (grad) { const g = ctx.createLinearGradient(0, 0, w * 0.4, h); g.addColorStop(0, grad[0]); g.addColorStop(1, grad[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  else { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.save(); if (pat?.opacity != null) ctx.globalAlpha = pat.opacity;
  const dark = lum(bg) < 0.45;
  const line = dark ? 'rgba(255,255,255,.14)' : 'rgba(30,41,90,.16)';
  const strong = dark ? 'rgba(255,255,255,.28)' : 'rgba(220,60,60,.35)';
  const patc = pat?.color;
  ctx.lineWidth = 1; ctx.strokeStyle = patc || line; ctx.fillStyle = patc || line;
  const hl = (y, x0 = 0, x1 = w) => { ctx.beginPath(); ctx.moveTo(x0, y + .5); ctx.lineTo(x1, y + .5); ctx.stroke(); };
  const vl = (x, y0 = 0, y1 = h) => { ctx.beginPath(); ctx.moveTo(x + .5, y0); ctx.lineTo(x + .5, y1); ctx.stroke(); };
  if (preset === 'staff') {
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
    for (let y0 = 90; y0 < h - 90; y0 += 100) for (let i = 0; i < 5; i++) hl(y0 + i * 12, 50, w - 50);
    ctx.restore(); return;
  }
  if (preset === 'graph') {
    for (let y = 14, n = 0; y < h; y += 14, n++) { ctx.strokeStyle = n % 5 === 4 ? (dark ? 'rgba(255,255,255,.3)' : 'rgba(30,41,90,.32)') : line; hl(y); }
    for (let x = 14, n = 0; x < w; x += 14, n++) { ctx.strokeStyle = n % 5 === 4 ? (dark ? 'rgba(255,255,255,.3)' : 'rgba(30,41,90,.32)') : line; vl(x); }
    ctx.restore(); return;
  }
  if (preset === 'planner') {
    ctx.strokeStyle = line; hl(90); ctx.fillStyle = dark ? 'rgba(255,255,255,.5)' : 'rgba(30,41,90,.55)'; ctx.font = '13px sans-serif';
    for (let i = 0, y = 130; y < h - 40; i++, y += 44) { hl(y + 20, 70, w - 40); ctx.fillText(((6 + i) % 12 || 12) + (6 + i < 12 ? ' am' : ' pm'), 18, y + 15); }
    ctx.strokeStyle = strong; vl(66, 100, h - 30); ctx.restore(); return;
  }
  if (preset === 'weekly') {
    ctx.strokeStyle = strong; ctx.lineWidth = 1.5; const rowH = (h - 120) / 7;
    hl(90, 30, w - 30);
    for (let i = 0; i < 7; i++) { hl(90 + rowH * (i + 1), 30, w - 30); }
    ctx.strokeStyle = line; vl(130, 90, h - 30); ctx.restore(); return;
  }
  if (tpl === 'lined') {
    for (let y = 96; y < h - 20; y += 32) hl(y);
    ctx.strokeStyle = strong; vl(84);
  } else if (tpl === 'grid') {
    for (let y = 28; y < h; y += 28) hl(y);
    for (let x = 28; x < w; x += 28) vl(x);
  } else if (tpl === 'dot') {
    for (let y = 28; y < h; y += 28) for (let x = 28; x < w; x += 28) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 6.2832); ctx.fill(); }
  } else if (tpl === 'cornell') {
    for (let y = 120; y < h * 0.82; y += 32) hl(y);
    ctx.strokeStyle = strong; ctx.lineWidth = 1.5;
    vl(w * 0.27, 90, h * 0.82); hl(90); hl(h * 0.82);
  } else if (tpl === 'todo') {
    ctx.strokeStyle = line; hl(90);
    for (let y = 130; y < h - 30; y += 44) {
      ctx.strokeRect(54.5, y - 16.5, 20, 20); hl(y + 12, 90, w - 50);
    }
  }
  ctx.restore();
  const L = preset && LAYOUTS[preset]; if (L) drawLayout(ctx, w, h, L, dark);
}
