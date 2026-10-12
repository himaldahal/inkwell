// Export / backup / import. Heavy libs (pdf-lib) are lazy-loaded.
import { getAll, getAllRaw, getRecord, getAsset, putRecord, rawPut, newId } from '../core/db.js';
import { emit, toast } from '../core/store.js';
import { blobToDataURL } from '../core/utils.js';
import { renderPdfPage } from './pdf.js';
import { htmlToMarkdown, htmlToText, textToHtml } from './convert.js';
import { makeZip } from './zip.js';

export { htmlToMarkdown, htmlToText, markdownToHtml } from './convert.js';
export { importFiles } from './import.js';

// ---------------------------------------------------------------- rendering
const GRID = 32;

export function drawTemplate(ctx, w, h, tpl, paper = '#ffffff') {
  ctx.fillStyle = paper || '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const line = 'rgba(120,140,170,0.35)', dot = 'rgba(120,140,170,0.6)';
  ctx.lineWidth = 1; ctx.strokeStyle = line; ctx.fillStyle = dot;
  const hline = (y, x0 = 0, x1 = w) => { ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke(); };
  const vline = (x, y0 = 0, y1 = h) => { ctx.beginPath(); ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); ctx.stroke(); };
  switch (tpl) {
    case 'lined': for (let y = 80; y < h; y += GRID) hline(y); ctx.strokeStyle = 'rgba(220,90,90,0.4)'; vline(72); break;
    case 'grid': for (let y = GRID; y < h; y += GRID) hline(y); for (let x = GRID; x < w; x += GRID) vline(x); break;
    case 'dot': for (let y = GRID; y < h; y += GRID) for (let x = GRID; x < w; x += GRID) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 6.2832); ctx.fill(); } break;
    case 'cornell': {
      const cue = Math.round(w * 0.27), sum = Math.round(h * 0.82);
      for (let y = 80; y < sum; y += GRID) hline(y, cue, w);
      ctx.strokeStyle = 'rgba(80,90,120,0.6)'; ctx.lineWidth = 1.5; vline(cue, 0, sum); hline(sum); hline(60, 0, w);
      break;
    }
    case 'todo': for (let y = 90; y < h - 20; y += 44) { hline(y + 22, 56, w - 30); ctx.strokeRect(24.5, y - 4.5, 20, 20); } break;
    default: break;
  }
}

function drawStroke(ctx, s) {
  const p = s.pts || [];
  const n = Math.floor(p.length / 3);
  if (!n) return;
  const size = s.size || 3;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = s.color || '#000';
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'butt'; ctx.lineWidth = size;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    if (n === 1) ctx.lineTo(p[0] + 0.01, p[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3], p[i * 3 + 1]);
    ctx.stroke();
  } else {
    const pencil = s.tool === 'pencil';
    if (pencil) ctx.globalAlpha = 0.8;
    const wOf = (pr) => size * (pencil ? 0.5 + 0.8 * pr : 0.35 + 1.3 * pr);
    if (n === 1) {
      ctx.beginPath(); ctx.arc(p[0], p[1], wOf(p[2] || 0.5) / 2, 0, 6.2832); ctx.fill();
    } else {
      // quadratic through midpoints, width varied per segment
      let px = p[0], py = p[1];
      for (let i = 1; i < n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1];
        const pr = ((p[i * 3 + 2] || 0.5) + (p[(i - 1) * 3 + 2] || 0.5)) / 2;
        const mx = (px + x) / 2, my = (py + y) / 2;
        ctx.lineWidth = wOf(pr);
        ctx.beginPath(); ctx.moveTo(i === 1 ? px : (px + p[(i - 2) * 3]) / 2, i === 1 ? py : (py + p[(i - 2) * 3 + 1]) / 2);
        ctx.quadraticCurveTo(px, py, mx, my);
        ctx.stroke();
        px = x; py = y;
      }
      ctx.lineWidth = wOf(p[(n - 1) * 3 + 2] || 0.5);
      ctx.beginPath(); ctx.moveTo((px + p[(n - 2) * 3]) / 2, (py + p[(n - 2) * 3 + 1]) / 2); ctx.lineTo(px, py); ctx.stroke();
    }
  }
  ctx.restore();
}

async function itemBitmap(it) {
  try {
    let src = it.src || it.url || it.data?.src || it.dataUrl;
    if (!src && (it.assetId || it.data?.assetId)) {
      const a = await getAsset(it.assetId || it.data.assetId);
      if (a?.blob) return await createImageBitmap(a.blob);
    }
    if (!src) return null;
    const blob = await (await fetch(src)).blob();
    return await createImageBitmap(blob);
  } catch { return null; }
}

async function drawItem(ctx, it) {
  ctx.save();
  const w = it.w || 100, h = it.h || 40;
  ctx.translate(it.x + w / 2, it.y + h / 2);
  if (it.rotation) ctx.rotate(it.rotation * (Math.abs(it.rotation) > 6.3 ? Math.PI / 180 : 1));
  ctx.translate(-w / 2, -h / 2);
  const d = it.data || {};
  const color = it.color || d.color || it.stroke || d.stroke || '#000';
  if (it.type === 'image') {
    const bm = await itemBitmap(it);
    if (bm) { ctx.drawImage(bm, 0, 0, w, h); bm.close?.(); }
  } else if (it.type === 'text') {
    const size = it.fontSize || d.fontSize || 18;
    ctx.fillStyle = color; ctx.textBaseline = 'top';
    ctx.font = `${it.bold || d.bold ? 'bold ' : ''}${it.italic || d.italic ? 'italic ' : ''}${size}px ${it.font || d.font || 'system-ui, sans-serif'}`;
    const text = String(it.text ?? d.text ?? '');
    let y = 0;
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (line && ctx.measureText(t).width > w) { ctx.fillText(line, 0, y); y += size * 1.3; line = word; } else line = t;
      }
      ctx.fillText(line, 0, y); y += size * 1.3;
    }
  } else if (it.type === 'shape') {
    const kind = it.shape || d.shape || it.kind || 'rect';
    ctx.strokeStyle = color; ctx.lineWidth = it.strokeWidth || d.strokeWidth || it.size || 2;
    const fill = it.fill || d.fill; if (fill && fill !== 'none') ctx.fillStyle = fill;
    ctx.beginPath();
    if (kind === 'ellipse' || kind === 'circle') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 6.2832);
    else if (kind === 'line' || kind === 'arrow') {
      ctx.moveTo(0, 0); ctx.lineTo(w, h);
      if (kind === 'arrow') { const a = Math.atan2(h, w), L = 14; ctx.moveTo(w, h); ctx.lineTo(w - L * Math.cos(a - 0.45), h - L * Math.sin(a - 0.45)); ctx.moveTo(w, h); ctx.lineTo(w - L * Math.cos(a + 0.45), h - L * Math.sin(a + 0.45)); }
    } else if (kind === 'triangle') { ctx.moveTo(w / 2, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); }
    else ctx.rect(0, 0, w, h);
    if (fill && fill !== 'none') ctx.fill();
    ctx.stroke();
  } else if (it.type === 'sticker') {
    ctx.font = `${Math.min(w, h) * 0.85}px sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(it.emoji || d.emoji || it.text || d.text || '⭐', w / 2, h / 2);
  }
  ctx.restore();
}

/**
 * Render a note page to a new canvas (page units * scale).
 * opts: { scale=2, layer: 'all'|'annotations'|'background', canvas }
 * 'annotations' = strokes + items on a transparent canvas (used for non-flattened PDF export).
 */
export async function renderPageToCanvas(page, note, opts = {}) {
  const scale = opts.scale || 2, layer = opts.layer || 'all';
  const W = page.width || 820, H = page.height || 1160;
  const c = opts.canvas || document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  if (layer !== 'annotations') {
    if (page.type === 'pdf' && page.pdfAssetId) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      try {
        const tmp = document.createElement('canvas');
        await renderPdfPage(page.pdfAssetId, page.pdfPage || 1, tmp, 1, { cssWidth: c.width, dpr: 1, noStyle: true, progressive: false });
        ctx.drawImage(tmp, 0, 0, c.width, c.height);
      } catch (e) { console.warn('pdf page render failed', e); }
    } else {
      ctx.save(); ctx.scale(scale, scale);
      drawTemplate(ctx, W, H, page.bg || note.template || 'blank', note.paperColor || '#ffffff');
      ctx.restore();
    }
  }
  if (layer !== 'background') {
    ctx.save(); ctx.scale(scale, scale);
    for (const it of page.items || []) if (it.type === 'image') await drawItem(ctx, it);
    for (const s of page.strokes || []) drawStroke(ctx, s);
    for (const it of page.items || []) if (it.type !== 'image') await drawItem(ctx, it);
    ctx.restore();
  }
  return c;
}

const canvasBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), type, q));

// ---------------------------------------------------------------- download / share
const safeName = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

async function deliver(blob, filename) {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  return 'downloaded';
}

/** Share or copy plain text (share-target friendly). */
export async function shareText(text, title = '') {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return 'copied'; } catch { /* fall through */ }
  download(new Blob([text], { type: 'text/plain' }), safeName(title || 'shared') + '.txt');
  return 'downloaded';
}

/** Create a note from shared text/url (Web Share Target). Returns noteId. */
export async function createNoteFromShare({ title = '', text = '', url = '' } = {}) {
  const body = [text, url].filter(Boolean).join('\n\n');
  const { blankNote } = await import('../core/db.js');
  const note = blankNote({ title: title || body.split('\n')[0].slice(0, 60) || 'Shared note', text: textToHtml(body), textIndex: body });
  await putRecord('notes', note);
  return note.id;
}

// ---------------------------------------------------------------- per-format builders
async function noteAssets(note) {
  const ids = new Set();
  for (const p of note.pages || []) { if (p.pdfAssetId) ids.add(p.pdfAssetId); for (const it of p.items || []) { const a = it.assetId || it.data?.assetId; if (a) ids.add(a); } }
  for (const r of note.recordings || []) ids.add(r.assetId);
  const all = await getAllRaw('assets');
  return all.filter((a) => !a.deleted && (a.noteId === note.id || ids.has(a.id)));
}
const b64 = async (blob) => (await blobToDataURL(blob)).split(',')[1] || '';
async function assetToJson(a) {
  const { blob, dirty, ...rest } = a;
  return { ...rest, data: blob ? await b64(blob) : null };
}
function b64ToBytes(s) {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function stripNote(n) { const { dirty, ...r } = n; return r; }

async function buildPdf(note, { flatten = false, scale = 2, onProgress } = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  out.setTitle(note.title || 'Untitled'); out.setProducer('Inkwell'); out.setCreator('Inkwell');
  const srcDocs = new Map();
  const pages = note.pages?.length ? note.pages : [];
  let i = 0;
  for (const page of pages) {
    const W = (page.width || 820) * 0.75, H = (page.height || 1160) * 0.75;
    let done = false;
    if (!flatten && page.type === 'pdf' && page.pdfAssetId) {
      try {
        if (!srcDocs.has(page.pdfAssetId)) {
          const a = await getAsset(page.pdfAssetId);
          srcDocs.set(page.pdfAssetId, await PDFDocument.load(await a.blob.arrayBuffer(), { ignoreEncryption: false }));
        }
        const [emb] = await out.embedPdf(srcDocs.get(page.pdfAssetId), [(page.pdfPage || 1) - 1]);
        const pg = out.addPage([W, H]);
        pg.drawPage(emb, { x: 0, y: 0, width: W, height: H });
        if ((page.strokes?.length || page.items?.length)) {
          const ov = await renderPageToCanvas(page, note, { scale, layer: 'annotations' });
          const img = await out.embedPng(await (await canvasBlob(ov)).arrayBuffer());
          pg.drawImage(img, { x: 0, y: 0, width: W, height: H });
        }
        done = true;
      } catch (e) { console.warn('layered pdf page failed, flattening', e); }
    }
    if (!done) {
      const c = await renderPageToCanvas(page, note, { scale });
      const img = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
      out.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
    }
    onProgress?.(++i, pages.length);
    await new Promise((r) => setTimeout(r)); // keep UI responsive
  }
  if (!pages.length) out.addPage([612, 792]);
  return new Blob([await out.save()], { type: 'application/pdf' });
}

function mdFor(note) {
  const body = note.text ? htmlToMarkdown(note.text) : '';
  const tags = (note.tags || []).length ? '\n' + note.tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' ') + '\n' : '';
  return `# ${note.title || 'Untitled'}\n${tags}\n${body}`.trimEnd() + '\n';
}
function txtFor(note) {
  return `${note.title || 'Untitled'}\n\n${note.text ? htmlToText(note.text) : ''}`.trimEnd() + '\n';
}
const backupEnvelope = async (notes, notebooks, assets) => ({
  format: 'inkwell-backup', version: 1, exportedAt: Date.now(),
  notebooks: notebooks.map((n) => { const { dirty, ...r } = n; return r; }),
  notes: notes.map(stripNote),
  assets: await Promise.all(assets.map(assetToJson)),
});

/** Build a file for one note: returns { blob, filename } (png: first page only). */
export async function buildNoteFile(note, fmt, opts = {}) {
  const base = safeName(note.title);
  switch (fmt) {
    case 'pdf': return { blob: await buildPdf(note, opts), filename: base + '.pdf' };
    case 'png': {
      const c = await renderPageToCanvas(note.pages[0], note, { scale: opts.scale || 2 });
      return { blob: await canvasBlob(c), filename: base + '.png' };
    }
    case 'md': return { blob: new Blob([mdFor(note)], { type: 'text/markdown' }), filename: base + '.md' };
    case 'txt': return { blob: new Blob([txtFor(note)], { type: 'text/plain' }), filename: base + '.txt' };
    case 'json': {
      const env = await backupEnvelope([note], [], await noteAssets(note));
      return { blob: new Blob([JSON.stringify(env)], { type: 'application/json' }), filename: base + '.inkwell.json' };
    }
    default: throw new Error('Unknown export format: ' + fmt);
  }
}

/**
 * exportNote(note, fmt, opts)  fmt: 'pdf'|'png'|'md'|'json'|'txt'
 * opts: { flatten=false (true => rasterize PDF-imported pages with annotations; false => keep original PDF page
 *         content as vector and place annotations as a separate transparent layer), scale=2, onProgress }
 * PNG on multi-page notes downloads every page (page-1.png, ...).
 */
export async function exportNote(note, fmt = 'pdf', opts = {}) {
  try {
    if (fmt === 'png' && (note.pages?.length || 0) > 1 && !opts.firstOnly) {
      const base = safeName(note.title);
      let i = 0;
      for (const page of note.pages) {
        const c = await renderPageToCanvas(page, note, { scale: opts.scale || 2 });
        download(await canvasBlob(c), `${base}-${++i}.png`);
        opts.onProgress?.(i, note.pages.length);
        await new Promise((r) => setTimeout(r, 350));
      }
      return 'downloaded';
    }
    const { blob, filename } = await buildNoteFile(note, fmt, opts);
    return await deliver(blob, filename);
  } catch (e) {
    console.error(e); toast('Export failed: ' + (e?.message || e)); throw e;
  }
}

/** Zip of every note in a notebook (and sub-notebooks). notebookId null => unfiled notes; 'all' => everything. */
export async function exportNotebook(notebookId, fmt = 'pdf', opts = {}) {
  const [notebooks, notes] = await Promise.all([getAll('notebooks'), getAll('notes')]);
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const pathOf = (id) => { const parts = []; let n = byId.get(id), g = 0; while (n && g++ < 20) { parts.unshift(safeName(n.name)); n = byId.get(n.parentId); } return parts.join('/'); };
  const inScope = (nbId) => {
    if (notebookId === 'all') return true;
    if (notebookId === null) return !nbId;
    for (let n = byId.get(nbId), g = 0; n && g++ < 20; n = byId.get(n.parentId)) if (n.id === notebookId) return true;
    return false;
  };
  const list = notes.filter((n) => !n.trashedAt && inScope(n.notebookId));
  if (!list.length) { toast('Nothing to export'); return 'empty'; }
  const files = []; let i = 0;
  for (const n of list) {
    try {
      const { blob, filename } = await buildNoteFile(n, fmt, { ...opts, flatten: opts.flatten });
      const dir = n.notebookId ? pathOf(n.notebookId) : '';
      files.push({ name: (dir ? dir + '/' : '') + filename, data: blob });
    } catch (e) { console.warn('skip note', n.id, e); }
    opts.onProgress?.(++i, list.length);
    await new Promise((r) => setTimeout(r));
  }
  const nb = byId.get(notebookId);
  return deliver(await makeZip(files), safeName(nb?.name || (notebookId === 'all' ? 'Inkwell notes' : 'Inkwell')) + '.zip');
}

// ---------------------------------------------------------------- encrypted backup
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function deriveKey(pass, salt, usage) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}
async function encryptBytes(bytes, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(pass, salt, ['encrypt']), bytes));
  return JSON.stringify({ format: 'inkwell-encrypted', version: 1, kdf: 'PBKDF2-SHA256-250000', salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
}
async function decryptEnvelope(env, pass) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, await deriveKey(pass, b64ToBytes(env.salt), ['decrypt']), b64ToBytes(env.data));
    return new TextDecoder().decode(pt);
  } catch { const e = new Error('Wrong passphrase or corrupted backup.'); e.code = 'BAD_PASSPHRASE'; throw e; }
}

/** Full backup file. opts.passphrase => AES-GCM encrypted. Downloads and returns the Blob. */
export async function exportAll(opts = {}) {
  const [notebooks, notes, assets] = await Promise.all([getAll('notebooks'), getAll('notes'), getAll('assets')]);
  const env = await backupEnvelope(notes, notebooks, assets);
  const json = JSON.stringify(env);
  const stamp = new Date().toISOString().slice(0, 10);
  let blob, name;
  if (opts.passphrase) {
    blob = new Blob([await encryptBytes(new TextEncoder().encode(json), opts.passphrase)], { type: 'application/json' });
    name = `inkwell-backup-${stamp}.enc.json`;
  } else { blob = new Blob([json], { type: 'application/json' }); name = `inkwell-backup-${stamp}.json`; }
  if (opts.download !== false) await deliver(blob, name);
  return blob;
}

/**
 * Merge a backup (plain or encrypted) into the local DB. Newer updatedAt wins. Imported records are marked
 * dirty so sync pushes them. opts.passphrase for encrypted files (throws Error.code='PASSPHRASE_REQUIRED' if missing).
 * Returns { notebooks, notes, assets, skipped }.
 */
export async function importBackup(file, opts = {}) {
  let env;
  try { env = JSON.parse(await file.text()); } catch { throw new Error('Not a valid Inkwell backup file.'); }
  if (env?.format === 'inkwell-encrypted') {
    if (!opts.passphrase) { const e = new Error('This backup is encrypted. Enter its passphrase.'); e.code = 'PASSPHRASE_REQUIRED'; throw e; }
    env = JSON.parse(await decryptEnvelope(env, opts.passphrase));
  }
  if (env?.format !== 'inkwell-backup') throw new Error('Not a valid Inkwell backup file.');
  const counts = { notebooks: 0, notes: 0, assets: 0, skipped: 0 };
  const merge = async (store, rec, prep) => {
    if (!rec?.id) { counts.skipped++; return; }
    const cur = await getRecord(store, rec.id);
    if (cur && (cur.updatedAt || 0) >= (rec.updatedAt || 0)) { counts.skipped++; return; }
    const out = prep ? await prep(rec) : { ...rec };
    out.updatedAt = rec.updatedAt || Date.now(); out.createdAt ||= out.updatedAt; out.deleted = !!out.deleted; out.dirty = 1;
    await rawPut(store, out, { silent: true });
    counts[store]++;
  };
  for (const nb of env.notebooks || []) await merge('notebooks', nb);
  for (const a of env.assets || []) {
    await merge('assets', a, async (r) => {
      const { data, ...rest } = r;
      if (data) rest.blob = new Blob([b64ToBytes(data)], { type: r.mime || 'application/octet-stream' });
      return rest;
    });
  }
  for (const n of env.notes || []) await merge('notes', n);
  if (counts.notebooks) emit('notebooks:changed', { import: true });
  if (counts.notes || counts.assets) emit('notes:changed', { import: true });
  return counts;
}

export { newId as _newId };
