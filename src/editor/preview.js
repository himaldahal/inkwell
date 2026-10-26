// Note preview thumbnails: background colour + template, PDF page, ink, items and typed text.
import { drawTemplate, paperOf, patternOf } from './templates.js';
import { paintPage } from './pages.js';
import { flattenCanvas } from './canvasmode.js';
import { getImage } from './assets.js';

function wrap(ctx, text, maxW) {
  const out = []; let line = '';
  for (const w of text.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}
/** typed-text thumbnail for notes without ink */
export function paintTextPreview(ctx, note, W, H) {
  const paper = paperOf(note, note.pages[0] || {});
  drawTemplate(ctx, W, H, 'blank', Array.isArray(paper) || paper === 'none' ? paper : paper || '#fff', null, patternOf(note, note.pages[0] || {}));
  const dark = /^#?[0-3][0-9a-f]{5}$/i.test(typeof paper === 'string' ? paper : '');
  const ink = dark ? '#eee' : '#1f2937', sub = dark ? '#aaa' : '#6b7280', pad = W * 0.07, maxW = W - pad * 2;
  let y = pad;
  ctx.textBaseline = 'top'; ctx.fillStyle = ink;
  const firstH = (() => { const d0 = document.createElement('div'); d0.innerHTML = note.text || ''; return (d0.querySelector('h1,h2,h3')?.textContent || '').trim().toLowerCase(); })();
  if (note.title && firstH !== note.title.trim().toLowerCase()) { ctx.font = `700 ${W * 0.075}px system-ui, sans-serif`; for (const l of wrap(ctx, note.title, maxW).slice(0, 2)) { ctx.fillText(l, pad, y); y += W * 0.095; } y += W * 0.02; }
  const d = document.createElement('div'); d.innerHTML = note.text || '';
  const blocks = [...d.querySelectorAll('h1,h2,h3,p,li,div')].filter((b) => !b.querySelector('h1,h2,h3,p,li,div'));
  for (const b of blocks) {
    const t = b.textContent.trim(); if (!t) continue;
    const tag = b.tagName, big = /^H[123]$/.test(tag), fs = W * (tag === 'H1' ? 0.062 : big ? 0.054 : 0.045);
    ctx.font = `${big ? '700 ' : ''}${fs}px system-ui, sans-serif`; ctx.fillStyle = big ? ink : sub;
    const prefix = tag === 'LI' ? '• ' : '';
    for (const l of wrap(ctx, prefix + t, maxW).slice(0, 3)) { if (y > H - pad) return; ctx.fillText(l, pad, y); y += fs * 1.4; }
    y += fs * 0.3;
  }
}
function compose(note, W, pdfCanvas) {
  const pg = flattenCanvas(note.pages[0]);
  const hasContent = pg && (pg.type === 'pdf' || pg.strokes.some((s) => !s.deleted) || pg.items.some((i) => !i.deleted));
  const textOnly = !hasContent && (note.text || '').replace(/<[^>]*>/g, '').trim();
  const ratio = textOnly || !pg ? 1.3 : pg.height / pg.width, c = document.createElement('canvas');
  c.width = W; c.height = Math.round(W * Math.min(1.6, ratio));
  const ctx = c.getContext('2d');
  if (textOnly || !pg) paintTextPreview(ctx, note, c.width, c.height);
  else { const k = W / pg.width; ctx.scale(k, k); paintPage(ctx, note, pg, { pdfCanvas }); }
  return c;
}
export function renderNotePreviewSync(note, { w = 360, pdfCanvas } = {}) {
  try { return compose(note, w, pdfCanvas).toDataURL('image/jpeg', 0.62); } catch { return null; }
}
/** Full preview incl. async assets (images, PDF first page). Returns a JPEG data URL. */
export async function renderNotePreview(note, { w = 360 } = {}) {
  const pg = note.pages[0]; let pdfCanvas = null;
  if (pg) {
    const ids = [pg.bgImage?.assetId, ...(pg.items || []).filter((i) => i.type === 'image' && !i.deleted).map((i) => i.assetId)].filter(Boolean);
    await Promise.all(ids.map((a) => getImage(a)));
    if (pg.type === 'pdf' && pg.pdfAssetId) {
      try { const m = await import('../features/pdf.js'); pdfCanvas = document.createElement('canvas'); await m.renderPdfPage(pg.pdfAssetId, pg.pdfPage || 1, pdfCanvas, 1, { cssWidth: w, dpr: 1, noStyle: true, progressive: false }); } catch { pdfCanvas = null; }
    }
  }
  return renderNotePreviewSync(note, { w, pdfCanvas });
}
