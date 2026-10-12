// PDF import / render / text extraction. pdfjs is lazy-loaded on first use.
import { putAsset, getAsset, getRecord, putRecord } from '../core/db.js';
import { blankNote, newId } from '../core/db.js';
import { emit } from '../core/store.js';

export const PAGE_WIDTH = 820;

let pdfjsP;
function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
    pdfjsP.catch(() => { pdfjsP = null; });
  }
  return pdfjsP;
}

// ---- document cache (assetId -> Promise<PDFDocumentProxy>) -----------------
const docs = new Map();
const MAX_DOCS = 4;

export function getPdfDocument(assetId) {
  if (docs.has(assetId)) {
    const p = docs.get(assetId); docs.delete(assetId); docs.set(assetId, p); // LRU touch
    return p;
  }
  const p = (async () => {
    const [lib, asset] = await Promise.all([loadPdfjs(), getAsset(assetId)]);
    if (!asset || !asset.blob) throw new Error('PDF asset not found: ' + assetId);
    const data = new Uint8Array(await asset.blob.arrayBuffer());
    return lib.getDocument({ data }).promise;
  })();
  docs.set(assetId, p);
  p.catch(() => docs.delete(assetId));
  while (docs.size > MAX_DOCS) {
    const k = docs.keys().next().value;
    const old = docs.get(k); docs.delete(k);
    old.then((d) => d.destroy()).catch(() => {});
  }
  return p;
}

/** Drop a cached document (e.g. after asset deletion). */
export function releasePdf(assetId) {
  const p = docs.get(assetId);
  docs.delete(assetId);
  p?.then((d) => d.destroy()).catch(() => {});
}

// ---- rendering ------------------------------------------------------------
const tasks = new WeakMap(); // canvas -> token {task}
// rendered-bitmap cache (LRU by pixel budget)
const bitmaps = new Map(); // key -> canvas
let bitmapPx = 0;
const MAX_PX = 48e6;
function cachePut(key, c) {
  if (bitmaps.has(key)) { bitmapPx -= bitmaps.get(key).width * bitmaps.get(key).height; bitmaps.delete(key); }
  bitmaps.set(key, c); bitmapPx += c.width * c.height;
  for (const [k, v] of bitmaps) {
    if (bitmapPx <= MAX_PX || bitmaps.size <= 2) break;
    bitmapPx -= v.width * v.height; bitmaps.delete(k);
  }
}
export function clearPdfBitmapCache() { bitmaps.clear(); bitmapPx = 0; }

async function paint(page, cssW, dpr, token) {
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const task = page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(255,255,255,1)' });
  token.task = task;
  try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return null; throw e; }
  return c;
}

/**
 * Render PDF page `pageNo` (1-based) into `canvas`.
 * `scale` is relative to note page units: scale 1 => the page is PAGE_WIDTH (820) CSS px wide.
 * opts.cssWidth overrides the CSS width; opts.dpr overrides devicePixelRatio; opts.noStyle skips style sizing;
 * opts.progressive=false disables the low-res placeholder pass.
 * Draws a low-res placeholder immediately, then the full-res bitmap (cached). A newer call on the same canvas
 * cancels the older one. Resolves true when painted, false if superseded.
 */
export async function renderPdfPage(assetId, pageNo, canvas, scale = 1, opts = {}) {
  const prev = tasks.get(canvas);
  if (prev) { try { prev.task?.cancel(); } catch { /* ignore */ } }
  const token = {};
  tasks.set(canvas, token);
  const dpr = opts.dpr || Math.min(window.devicePixelRatio || 1, 3);
  const cssW = opts.cssWidth || PAGE_WIDTH * scale;
  const key = `${assetId}:${pageNo}:${Math.round(cssW * dpr)}`;
  const size = (w, h) => {
    canvas.width = w; canvas.height = h;
    if (!opts.noStyle) { canvas.style.width = Math.round(w / dpr) + 'px'; canvas.style.height = Math.round(h / dpr) + 'px'; }
  };
  const hit = bitmaps.get(key);
  if (hit) {
    bitmaps.delete(key); bitmaps.set(key, hit);
    size(hit.width, hit.height); canvas.getContext('2d').drawImage(hit, 0, 0);
    tasks.delete(canvas); return true;
  }
  const doc = await getPdfDocument(assetId);
  if (tasks.get(canvas) !== token) return false;
  const page = await doc.getPage(pageNo);
  if (tasks.get(canvas) !== token) return false;
  const base = page.getViewport({ scale: 1 });
  const fullW = Math.max(1, Math.round(base.width * (cssW / base.width) * dpr));
  const fullH = Math.max(1, Math.round(base.height * (cssW / base.width) * dpr));
  if (opts.progressive !== false && fullW > 400) {
    const low = await paint(page, Math.min(cssW, 200), 1, token);
    if (!low || tasks.get(canvas) !== token) return false;
    size(fullW, fullH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(low, 0, 0, fullW, fullH);
  }
  const full = await paint(page, cssW, dpr, token);
  if (!full || tasks.get(canvas) !== token) return false;
  cachePut(key, full);
  size(full.width, full.height);
  canvas.getContext('2d').drawImage(full, 0, 0);
  page.cleanup();
  tasks.delete(canvas);
  return true;
}

export function cancelPdfRender(canvas) {
  const t = tasks.get(canvas);
  if (t) { try { t.task?.cancel(); } catch { /* ignore */ } tasks.set(canvas, {}); }
}

// ---- text -----------------------------------------------------------------
const textCache = new Map();
export async function getPdfPageText(assetId, pageNo) {
  const key = assetId + ':' + pageNo;
  if (textCache.has(key)) return textCache.get(key);
  const doc = await getPdfDocument(assetId);
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(' ').replace(/[ \t]+/g, ' ').trim();
  if (textCache.size > 500) textCache.clear();
  textCache.set(key, text);
  return text;
}

// ---- import ---------------------------------------------------------------
const MAX_INDEX = 300000;
const yieldNow = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 60 }) : setTimeout(r, 0)));

/**
 * Import a PDF File/Blob. Appends pages to noteId, or creates a new note. Returns the note id.
 * Page records are created in chunks (yielding to the UI); the note is saved as soon as all page
 * sizes are known, and text indexing continues in the background (note.textIndex updated later).
 * opts.onProgress(done,total)
 */
export async function importPdfToNote(file, noteId = null, opts = {}) {
  const lib = await loadPdfjs();
  const buf = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await lib.getDocument({ data: buf.slice() }).promise;
  } catch (e) {
    throw new Error(e?.name === 'PasswordException' ? 'This PDF is password protected.' : 'Could not read this PDF.');
  }
  let note = noteId ? await getRecord('notes', noteId) : null;
  const fresh = !note;
  const title = (file.name || 'Imported PDF').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'Imported PDF';
  if (fresh) note = blankNote({ title, template: 'blank', pages: [] });

  const blob = file instanceof Blob && file.type === 'application/pdf' ? file : new Blob([buf], { type: 'application/pdf' });
  const asset = await putAsset({ noteId: note.id, kind: 'pdf', blob, mime: 'application/pdf' });

  const total = pdf.numPages;
  const pages = [];
  let thumb = null, firstSize = null;
  for (let i = 1; i <= total; i++) {
    let w = firstSize?.w, h = firstSize?.h;
    // pages of a PDF are almost always the same size: read every page for the first 20, then sample lazily
    if (!firstSize || i <= 20 || i % 25 === 0 || total < 60) {
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      w = vp.width; h = vp.height;
      if (i === 1) {
        firstSize = { w, h };
        if (fresh) {
          try {
            const c = document.createElement('canvas');
            const tvp = p.getViewport({ scale: 260 / vp.width });
            c.width = Math.round(tvp.width); c.height = Math.round(tvp.height);
            await p.render({ canvasContext: c.getContext('2d'), viewport: tvp, background: 'rgba(255,255,255,1)' }).promise;
            thumb = c.toDataURL('image/jpeg', 0.7);
          } catch { /* optional */ }
        }
      }
      p.cleanup();
    }
    const k = PAGE_WIDTH / w;
    pages.push({ id: newId(), type: 'pdf', pdfAssetId: asset.id, pdfPage: i, width: PAGE_WIDTH, height: Math.round(h * k), strokes: [], items: [] });
    if (i % 10 === 0) { opts.onProgress?.(i, total); await yieldNow(); }
  }
  opts.onProgress?.(total, total);

  note.pages = (note.pages || []).concat(pages);
  if (fresh || !note.preview) note.preview = thumb || note.preview;
  if (!fresh && !note.title) note.title = title;
  await putRecord('notes', note);
  emit('notes:changed', { id: note.id });

  // background text indexing (does not block the caller)
  (async () => {
    const texts = [];
    let len = 0;
    for (let i = 1; i <= total && len < MAX_INDEX; i++) {
      try {
        const p = await pdf.getPage(i);
        const tc = await p.getTextContent();
        const t = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
        texts.push(t); len += t.length; p.cleanup();
      } catch { /* skip page */ }
      if (i % 8 === 0) await yieldNow();
    }
    try {
      const n = await getRecord('notes', note.id);
      if (n) {
        n.textIndex = ((n.textIndex || '') + '\n' + texts.join('\n')).trim().slice(0, MAX_INDEX * 2);
        await putRecord('notes', n, { silent: true });
        emit('notes:changed', { id: n.id, index: true });
      }
    } catch (e) { console.warn('pdf text index failed', e); }
    pdf.destroy();
  })();
  return note.id;
}
