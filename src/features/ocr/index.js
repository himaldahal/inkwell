// Modular OCR. Providers are swappable; the default (tesseract.js) loads lazily on first use.
import { tesseractProvider } from './provider-tesseract.js';
import { remoteProvider } from './remote.js';

const providers = new Map();
let defaultName = 'tesseract';
export function registerOcrProvider(name, impl) { providers.set(name, { name, ...impl }); }
export const listOcrProviders = () => [...providers.keys()];
export function setDefaultProvider(name) { if (!providers.has(name)) throw new Error('Unknown OCR provider: ' + name); defaultName = name; }
export const getDefaultProvider = () => defaultName;
registerOcrProvider('tesseract', tesseractProvider);
registerOcrProvider('remote', remoteProvider);
registerOcrProvider('none', { init() {}, async recognize() { return { text: '', words: [], confidence: 0 }; }, terminate() {} });

export { setOcrConfig } from './provider-tesseract.js';
export { setRemoteOcrConfig } from './remote.js';
export async function ocrEnabled() {
  try { const m = await import('../../core/modules.js'); return m.isEnabled ? !!m.isEnabled('ocr') : true; } catch { return true; }
}

// concurrency 1: jobs run through one promise chain
let chain = Promise.resolve();

/** Resize/greyscale/contrast/binarize a canvas-able source. Returns a canvas. */
export async function preprocess(src, { minWidth = 1600, maxWidth = 3000, binarize = true } = {}) {
  let bm = src;
  if (src instanceof Blob) bm = await createImageBitmap(src);
  const w0 = bm.width, h0 = bm.height;
  const k = Math.min(maxWidth / w0, Math.max(1, minWidth / w0)); // upscale small (handwriting), cap huge
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bm, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  const g = new Uint8ClampedArray(d.length / 4);
  let lo = 255, hi = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; g[j] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1, hi - lo);
  // Otsu threshold on the contrast-stretched histogram
  const hist = new Uint32Array(256);
  for (let j = 0; j < g.length; j++) { g[j] = ((g[j] - lo) * 255) / span; hist[g[j] | 0]++; }
  let T = 128;
  if (binarize) {
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sB = 0, best = -1;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; T = t; } }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = binarize ? (g[j] > T ? 255 : 0) : g[j]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  if (src instanceof Blob) bm.close?.();
  return c;
}

/**
 * recognize(source, {lang, provider, onProgress(0..1), signal, preprocess=true}) -> {text, words, confidence}
 * source: canvas | ImageBitmap | Blob
 */
export async function recognize(source, opts = {}) {
  const name = opts.provider || defaultName;
  const p = providers.get(name);
  if (!p) throw new Error('Unknown OCR provider: ' + name);
  if (!(await ocrEnabled())) throw new Error('OCR is disabled.');
  const run = async () => {
    opts.signal?.throwIfAborted?.();
    const input = opts.preprocess === false || name === 'none' ? source : await preprocess(source, opts.pre);
    await p.init?.(opts);
    return p.recognize(input, { lang: opts.lang || 'eng', onProgress: opts.onProgress, signal: opts.signal });
  };
  const job = chain.then(run, run);
  chain = job.catch(() => {});
  return job;
}

export async function terminateOcr() { for (const p of providers.values()) await p.terminate?.(); }

// ------------------------------------------------------------ notes
import { getRecord, putRecord } from '../../core/db.js';
import { renderPageToCanvas } from '../export.js';

/** OCR every page of a note: returns {pageId: text}. Skips deleted-ink-only logic (renderer ignores deleted). */
export async function ocrNote(note, { onProgress, lang, provider, signal, pageIds } = {}) {
  const out = {};
  const pages = (note.pages || []).filter((p) => !pageIds || pageIds.includes(p.id));
  let i = 0;
  for (const page of pages) {
    signal?.throwIfAborted?.();
    const empty = page.type !== 'pdf' && !(page.strokes || []).some((s) => !s.deleted) && !(page.items || []).some((s) => !s.deleted);
    if (!empty) {
      const canvas = await renderPageToCanvas(page, note, { scale: 2 });
      const r = await recognize(canvas, { lang, provider, signal, onProgress: (f) => onProgress?.((i + f) / pages.length, page.id) });
      out[page.id] = r.text.trim();
    }
    onProgress?.(++i / pages.length, page.id);
  }
  return out;
}

const MARK = '\n⁣ocr⁣\n';
/** OCR a stored note, save note.ocr = {pageId: text} and make it searchable via textIndex. */
export async function indexNoteOcr(noteId, opts = {}) {
  const note = await getRecord('notes', noteId);
  if (!note) return null;
  const res = await ocrNote(note, opts);
  const fresh = await getRecord('notes', noteId);
  fresh.ocr = { ...(fresh.ocr || {}), ...res };
  const base = (fresh.textIndex || '').split(MARK)[0];
  fresh.textIndex = (base + MARK + Object.values(fresh.ocr).filter(Boolean).join('\n')).slice(0, 600000);
  await putRecord('notes', fresh);
  return fresh.ocr;
}
