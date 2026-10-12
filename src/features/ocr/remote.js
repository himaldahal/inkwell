// Provider stub: POST the image to a configurable URL. Expected JSON reply: {text, words?, confidence?}
const cfg = { url: '', headers: {}, field: 'image' };
export function setRemoteOcrConfig(o) { Object.assign(cfg, o); }
export const remoteProvider = {
  name: 'remote',
  init(o) { if (o?.remoteUrl) cfg.url = o.remoteUrl; },
  async recognize(input, { lang = 'eng', signal } = {}) {
    if (!cfg.url) throw new Error('Remote OCR URL not configured (setRemoteOcrConfig({url})).');
    const blob = input instanceof Blob ? input : await new Promise((r) => input.toBlob(r, 'image/png'));
    const fd = new FormData(); fd.append(cfg.field, blob, 'page.png'); fd.append('lang', lang);
    const res = await fetch(cfg.url, { method: 'POST', body: fd, headers: cfg.headers, signal });
    if (!res.ok) throw new Error('Remote OCR failed: ' + res.status);
    const j = await res.json();
    return { text: j.text || '', words: j.words || [], confidence: j.confidence ?? 0 };
  },
  terminate() {},
};
