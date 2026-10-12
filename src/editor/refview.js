// Read-only reference pane: view another note's pages beside the one being edited (wide screens).
import { h } from '../core/utils.js';
import { listNotes, getRecord } from '../core/db.js';
import { paintPage } from './pages.js';
import { getImage } from './assets.js';
import { icon } from './icons.js';
import { pref } from './ui.js';

export function mountRefView(host, engine, { onClose }) {
  const sel = h('select', { class: 'ik-ref-sel', 'aria-label': 'Reference note' }, h('option', { value: '' }, 'Choose a note...'));
  const close = h('button', { type: 'button', class: 'ik-btn sm', title: 'Close reference', 'aria-label': 'Close reference', onclick: () => onClose?.() }, icon('x', 18));
  const body = h('div', { class: 'ik-ref-body' });
  host.append(h('div', { class: 'ik-ref-head' }, sel, close), body);
  let ref = null, token = 0, ro;

  async function show(id) {
    const tk = ++token; body.replaceChildren(); ref = null;
    if (!id) return;
    ref = await getRecord('notes', id);
    if (!ref || tk !== token) return;
    pref.set('ref:' + engine.note.id, id);
    const ids = new Set();
    for (const p of ref.pages) { if (p.bgImage?.assetId) ids.add(p.bgImage.assetId); for (const it of p.items || []) if (it.type === 'image') ids.add(it.assetId); }
    await Promise.all([...ids].map((a) => getImage(a)));
    if (tk !== token) return;
    layout();
  }
  async function layout() {
    if (!ref) return;
    const tk = ++token, W = Math.max(200, body.clientWidth - 16), dpr = Math.min(2, window.devicePixelRatio || 1);
    body.replaceChildren();
    const pdf = ref.pages.some((p) => p.type === 'pdf') ? await engine.media.pdf() : null;
    for (const pg of ref.pages) {
      if (tk !== token) return;
      const k = W / pg.width, c = h('canvas', { class: 'ik-ref-page' });
      c.width = Math.round(W * dpr); c.height = Math.round(pg.height * k * dpr); c.style.width = W + 'px'; c.style.height = pg.height * k + 'px';
      body.append(c);
      let pc = null;
      if (pg.type === 'pdf' && pdf?.renderPdfPage) { pc = document.createElement('canvas'); try { await pdf.renderPdfPage(pg.pdfAssetId, pg.pdfPage || 1, pc, 1, { cssWidth: W * dpr, dpr: 1, noStyle: true }); } catch { pc = null; } }
      const ctx = c.getContext('2d'); ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      paintPage(ctx, ref, pg, { pdfCanvas: pc });
    }
  }
  sel.addEventListener('change', () => show(sel.value));
  (async () => {
    const all = (await listNotes()).filter((n) => n.id !== engine.note.id);
    all.forEach((n) => sel.append(h('option', { value: n.id }, n.title || 'Untitled')));
    const last = pref.get('ref:' + engine.note.id, '');
    if (last && all.some((n) => n.id === last)) { sel.value = last; show(last); }
  })();
  let t; ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(layout, 250); }); ro.observe(body);
  return { destroy() { token++; ro.disconnect(); host.replaceChildren(); } };
}
