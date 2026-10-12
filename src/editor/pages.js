// PageView: one page = layered canvases (bg, pdf, hl, ink, live) + DOM items layer + selection overlay.
import { h } from '../core/utils.js';
import { drawTemplate } from './templates.js';
import { drawStroke } from './stroke.js';
import { syncItems, clearItems } from './items.js';
import { getImage, cachedImage } from './assets.js';

const CTX_OPTS = { desynchronized: true, alpha: true };
const MAX_PX = 8e6;

export function drawBgImage(ctx, img, w, h, fit = 'contain') {
  if (fit === 'stretch') return ctx.drawImage(img, 0, 0, w, h);
  const k = (fit === 'cover' ? Math.max : Math.min)(w / img.width, h / img.height);
  const iw = img.width * k, ih = img.height * k;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

export class PageView {
  constructor(engine, page, index) {
    this.engine = engine; this.page = page; this.index = index;
    this.cv = {};
    this.ctxs = {};
    const names = ['bg', 'pdf', 'hl', 'ink', 'live'];
    this.el = h('div', { class: 'ik-page', 'data-id': page.id });
    for (const n of names) { const c = h('canvas', { class: 'ik-cv ik-cv-' + n }); this.cv[n] = c; this.el.append(c); }
    this.items = h('div', { class: 'ik-items' });
    this.sel = h('div', { class: 'ik-sel' });
    this.el.append(this.items, this.sel);
    this.visible = false; this.rendered = false; this.scale = 1; this.zoom = 1; this.token = 0;
  }
  get w() { return this.page.width; }
  get h() { return this.page.height; }
  ctx(n) {
    let c = this.ctxs[n];
    if (!c) c = this.ctxs[n] = this.cv[n].getContext('2d', n === 'ink' || n === 'live' || n === 'hl' ? CTX_OPTS : undefined);
    return c;
  }
  layout(zoom) {
    this.zoom = zoom;
    const { w, h: hh } = this;
    this.el.style.width = w * zoom + 'px'; this.el.style.height = hh * zoom + 'px';
    this.items.style.width = w + 'px'; this.items.style.height = hh + 'px'; this.items.style.transform = `scale(${zoom})`;
  }
  computeScale() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let s = dpr * this.zoom;
    s = Math.min(s, Math.sqrt(MAX_PX / (this.w * this.h)), 4096 / Math.max(this.w, this.h));
    return Math.max(0.25, s);
  }
  size(n, on = true) {
    const c = this.cv[n];
    const W = on ? Math.round(this.w * this.scale) : 1, H = on ? Math.round(this.h * this.scale) : 1;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const x = this.ctx(n);
    if (on) x.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    return x;
  }
  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    if (v) this.renderAll(); else this.release();
  }
  release() {
    this.token++;
    for (const n of Object.keys(this.cv)) { const c = this.cv[n]; if (c.width > 1) { c.width = 1; c.height = 1; } }
    clearItems(this); this.rendered = false;
  }
  renderAll() {
    this.token++;
    this.scale = this.computeScale();
    this.renderBg(); this.renderPdf();
    this.size('live');
    this.renderInk(); this.renderItems();
    this.rendered = true;
  }
  /** re-raster at new zoom (canvases get re-sized + redrawn) */
  rescale() { if (this.visible) this.renderAll(); }
  async renderBg() {
    const note = this.engine.note, pg = this.page, tk = this.token;
    const ctx = this.size('bg');
    if (pg.type === 'pdf') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.w, this.h); return; }
    drawTemplate(ctx, this.w, this.h, pg.bg || note.template || 'lined', note.paperColor, pg.bg ? null : note.preset);
    if (pg.bgImage?.assetId) {
      const img = cachedImage(pg.bgImage.assetId) || await getImage(pg.bgImage.assetId);
      if (img && tk === this.token) { drawTemplate(ctx, this.w, this.h, 'blank', note.paperColor); drawBgImage(ctx, img, this.w, this.h, pg.bgImage.fit); }
    }
  }
  async renderPdf() {
    const pg = this.page, c = this.cv.pdf, tk = this.token;
    if (pg.type !== 'pdf' || !pg.pdfAssetId) { if (c.width > 1) { c.width = 1; c.height = 1; } return; }
    const mod = await this.engine.media.pdf();
    if (tk !== this.token) return;
    c.width = Math.round(this.w * this.scale); c.height = Math.round(this.h * this.scale);
    if (!mod?.renderPdfPage) { this.ctx('pdf').fillStyle = '#eee'; this.ctx('pdf').fillRect(0, 0, c.width, c.height); return; }
    try { await mod.renderPdfPage(pg.pdfAssetId, pg.pdfPage || 1, c, 1, { cssWidth: this.w * this.scale, dpr: 1, noStyle: true }); }
    catch (e) { console.warn('pdf render failed', e); }
  }
  /** draw all committed strokes. `skip` = Set of stroke ids to leave out (while dragging a selection) */
  renderInk(skip) {
    if (!this.visible) return;
    const strokes = this.page.strokes;
    const ink = this.size('ink');
    ink.clearRect(0, 0, this.w, this.h);
    const hasHl = strokes.some((s) => !s.deleted && s.tool === 'highlighter');
    const hl = this.size('hl', hasHl);
    if (hasHl) hl.clearRect(0, 0, this.w, this.h);
    for (const s of strokes) {
      if (s.deleted || (skip && skip.has(s.id))) continue;
      drawStroke(s.tool === 'highlighter' ? hl : ink, s);
    }
  }
  renderItems() { if (this.visible) syncItems(this); }
  clearLive() { const c = this.cv.live; this.ctx('live').clearRect(0, 0, c.width / this.scale + 1, c.height / this.scale + 1); }
  destroy() { this.token++; for (const c of Object.values(this.cv)) { c.width = 1; c.height = 1; } this.el.remove(); }
}

/** Paint a page (template + pdf + ink + images) onto ctx in page units. For thumbnails, previews and export-ish uses. */
export function paintPage(ctx, note, page, { pdfCanvas, items = true } = {}) {
  const w = page.width, hh = page.height;
  if (page.type === 'pdf') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); if (pdfCanvas && pdfCanvas.width > 1) ctx.drawImage(pdfCanvas, 0, 0, w, hh); }
  else {
    drawTemplate(ctx, w, hh, page.bg || note.template || 'lined', note.paperColor, page.bg ? null : note.preset);
    const bi = page.bgImage && cachedImage(page.bgImage.assetId);
    if (bi) { drawTemplate(ctx, w, hh, 'blank', note.paperColor); drawBgImage(ctx, bi, w, hh, page.bgImage.fit); }
  }
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  for (const s of page.strokes) if (!s.deleted && s.tool === 'highlighter') drawStroke(ctx, s);
  ctx.restore();
  for (const s of page.strokes) if (!s.deleted && s.tool !== 'highlighter') drawStroke(ctx, s);
  if (!items) return;
  for (const it of page.items || []) {
    if (it.deleted) continue;
    ctx.save(); ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
    if (it.rotation) ctx.rotate((it.rotation * Math.PI) / 180);
    ctx.translate(-it.w / 2, -it.h / 2);
    if (it.type === 'image') { const im = cachedImage(it.assetId); if (im) ctx.drawImage(im, 0, 0, it.w, it.h); }
    else if (it.type === 'sticker') { ctx.font = `${Math.min(it.w, it.h) * 0.82}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.emoji || '⭐', it.w / 2, it.h / 2); }
    else if (it.type === 'text') {
      ctx.fillStyle = it.color || '#111827'; ctx.textBaseline = 'top'; const fs = it.fontSize || 20; ctx.font = `${fs}px sans-serif`;
      let y = 0; for (const line of String(it.text || '').split('\n')) { ctx.fillText(line, 0, y, it.w); y += fs * 1.35; }
    }
    ctx.restore();
  }
}
