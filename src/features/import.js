// Import images / PDF / Markdown / plain text files into new notes.
import { blankNote, putAsset, putRecord, newId } from '../core/db.js';
import { emit } from '../core/store.js';
import { importPdfToNote } from './pdf.js';
import { markdownToHtml, textToHtml, htmlToText } from './convert.js';

const baseTitle = (n) => (n || 'Imported').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported';
const ext = (f) => (f.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

async function importImage(file) {
  const note = blankNote({ title: baseTitle(file.name), template: 'blank' });
  const asset = await putAsset({ noteId: note.id, kind: 'image', blob: file, mime: file.type });
  let w = 600, h = 400;
  try { const bm = await createImageBitmap(file); w = bm.width; h = bm.height; bm.close?.(); } catch { /* keep default */ }
  const pw = 820, margin = 40, maxW = pw - margin * 2;
  const k = Math.min(1, maxW / w), dw = Math.round(w * k), dh = Math.round(h * k);
  const page = note.pages[0];
  page.height = Math.max(page.height, dh + margin * 2);
  page.items.push({ id: newId(), type: 'image', x: Math.round((pw - dw) / 2), y: margin, w: dw, h: dh, rotation: 0, assetId: asset.id });
  await putRecord('notes', note);
  return note.id;
}

async function importText(file, md) {
  const raw = await file.text();
  const html = md ? markdownToHtml(raw) : textToHtml(raw);
  let title = baseTitle(file.name);
  const h1 = md && raw.match(/^#\s+(.+)$/m);
  if (h1) title = h1[1].trim();
  const note = blankNote({ title, text: html, textIndex: htmlToText(html).slice(0, 200000) });
  await putRecord('notes', note);
  return note.id;
}

/** importFiles(FileList|File[], {onProgress}) -> { ids:[noteId], failed:[{name,error}] } */
export async function importFiles(fileList, opts = {}) {
  const files = [...fileList];
  const ids = [], failed = [];
  let i = 0;
  for (const f of files) {
    try {
      const e = ext(f);
      if (f.type === 'application/pdf' || e === 'pdf') ids.push(await importPdfToNote(f, null));
      else if (f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(e)) ids.push(await importImage(f));
      else if (e === 'md' || e === 'markdown' || f.type === 'text/markdown') ids.push(await importText(f, true));
      else if (e === 'txt' || f.type === 'text/plain') ids.push(await importText(f, false));
      else failed.push({ name: f.name, error: 'Unsupported file type' });
    } catch (err) { failed.push({ name: f.name, error: err?.message || String(err) }); }
    opts.onProgress?.(++i, files.length);
  }
  if (ids.length) emit('notes:changed', { import: true });
  return { ids, failed };
}
