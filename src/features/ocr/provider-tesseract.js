// Default provider: tesseract.js, lazy-loaded, worker + wasm core emitted by Vite (works offline).
// Language data (traineddata) is fetched once from `langPath` and cached by tesseract.js in IndexedDB.
// NOTE: Tesseract is good on printed text / PDF scans, weak on cursive handwriting.
const cfg = { langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast', idleMs: 60000 };
export function setOcrConfig(o) { Object.assign(cfg, o); }

let worker, workerLang, idleTimer, current;
const simd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; } };

async function ensure(lang, onProgress) {
  clearTimeout(idleTimer);
  if (worker && workerLang === lang) return worker;
  await terminate();
  const [{ createWorker }, wUrl, cUrl] = await Promise.all([
    import('tesseract.js/dist/tesseract.esm.min.js'),
    import('tesseract.js/dist/worker.min.js?url').then((m) => m.default),
    (simd() ? import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url') : import('tesseract.js-core/tesseract-core-lstm.wasm.js?url')).then((m) => m.default),
  ]);
  current = { onProgress };
  worker = await createWorker(lang, 1, {
    workerPath: new URL(wUrl, location.href).href, corePath: new URL(cUrl, location.href).href,
    langPath: cfg.langPath, workerBlobURL: false,
    logger: (m) => { if (m.status === 'recognizing text') current?.onProgress?.(m.progress); },
  });
  workerLang = lang;
  return worker;
}
async function terminate() {
  clearTimeout(idleTimer);
  const w = worker; worker = null; workerLang = null;
  try { await w?.terminate(); } catch { /* ignore */ }
}

export const tesseractProvider = {
  name: 'tesseract',
  init(o) { if (o?.langPath) cfg.langPath = o.langPath; },
  async recognize(input, { lang = 'eng', onProgress, signal } = {}) {
    const w = await ensure(lang, onProgress);
    current = { onProgress };
    const abort = () => terminate();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const { data } = await w.recognize(input, {}, { blocks: true });
      const words = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || [])
        words.push({ text: wd.text, bbox: wd.bbox, conf: wd.confidence });
      return { text: data.text || '', words, confidence: data.confidence ?? 0 };
    } finally {
      signal?.removeEventListener('abort', abort);
      idleTimer = setTimeout(terminate, cfg.idleMs); // free memory when idle
    }
  },
  terminate,
};
