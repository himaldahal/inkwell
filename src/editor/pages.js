// PageView: one page = layered canvases (bg, pdf, hl, ink, live) + DOM items layer + selection overlay.
import { h } from '../core/utils.js';
import { drawTemplate, paperOf, patternOf } from './templates.js';
import { drawStroke } from './stroke.js';
import { syncItems, clearItems } from './items.js';
import { getImage, cachedImage } from './assets.js';
import { bboxOf } from './stroke.js';
import { drawCanvasBg, flattenCanvas, sheetPages, pageH, CAM_MIN, CAM_MAX } from './canvasmode.js';

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
    this.el = h('div', { class: 'ik-page' + (page.infinite ? ' ik-infinite' : '') + (page.canvas ? ' ik-canvaspage' : ''), 'data-id': page.id });
    for (const n of names) { const c = h('canvas', { class: 'ik-cv ik-cv-' + n }); this.cv[n] = c; this.el.append(c); }
    this.items = h('div', { class: 'ik-items' });
    this.sel = h('div', { class: 'ik-sel' });
    this.el.append(this.items, this.sel);
    this.visible = false; this.rendered = false; this.scale = 1; this.zoom = 1; this.token = 0;
    this.vw = 0; this.vh = 0; this.dpr = 1;
  }
  get canvas() { return !!this.page.canvas; }
  /** one continuous sheet that grows page by page (vs. an unbounded free canvas) */
  get seamless() { return !!this.page.seamless; }
  get free() { return this.canvas && !this.seamless; }
  zoomRange() {
    if (!this.seamless) return [CAM_MIN, CAM_MAX];
    const fit = Math.min(1, (this.vw || 400) / this.page.width);
    return [Math.max(0.2, fit * 0.55), 4];
  }
  /** keep a seamless sheet in view: centred when narrow, never scrolled far past its ends */
  constrain() {
    if (!this.seamless) return;
    const c = this.cam, W = this.page.width, Hs = this.page.height, [lo, hi] = this.zoomRange();
    c.z = Math.min(hi, Math.max(lo, c.z));
    const vwW = this.vw / c.z, vhW = this.vh / c.z;
    c.x = W <= vwW - 16 / c.z ? W / 2 - vwW / 2 : Math.min(W + 24 / c.z - vwW, Math.max(-24 / c.z, c.x));
    const top = -86 / c.z; c.y = Math.min(Math.max(top, Hs + 130 / c.z - vhW), Math.max(top, c.y));
  }
  /** resize the sheet to its content (auto page breaks); true when the page count changed */
  fitSheet() {
    if (!this.seamless) return false;
    const h = sheetPages(this.page) * pageH(this.page);
    if (h === this.page.height) return false;
    this.page.height = h; return true;
  }
  /** camera of a free canvas page: world point at the top-left corner + zoom */
  get cam() { return this.page.cam || (this.page.cam = { x: 0, y: 0, z: 1 }); }
  get w() { return this.free ? this.vw / this.cam.z : this.page.width; }
  get h() { return this.free ? this.vh / this.cam.z : this.page.height; }
  /** page units -> offset inside the page element, in css px */
  sx(x) { return this.canvas ? (x - this.cam.x) * this.cam.z : x * this.zoom; }
  sy(y) { return this.canvas ? (y - this.cam.y) * this.cam.z : y * this.zoom; }
  ctx(n) {
    let c = this.ctxs[n];
    if (!c) c = this.ctxs[n] = this.cv[n].getContext('2d', n === 'ink' || n === 'live' || n === 'hl' ? CTX_OPTS : undefined);
    return c;
  }
  layout(zoom) {
    if (this.canvas) {
      const sc = this.engine.scroll, cam = this.cam;
      this.vw = sc.clientWidth; this.vh = sc.clientHeight;
      const [lo, hi] = this.zoomRange();
      cam.z = this.zoom = Math.min(hi, Math.max(lo, zoom)); this.constrain();
      this.el.style.width = this.vw + 'px'; this.el.style.height = this.vh + 'px';
      this.items.style.width = this.items.style.height = '0px';
      this.items.style.transform = `translate(${-cam.x * cam.z}px,${-cam.y * cam.z}px) scale(${cam.z})`;
      this.redraw(); return;
    }
    this.zoom = zoom;
    const { w, h: hh } = this;
    this.el.style.width = w * zoom + 'px'; this.el.style.height = hh * zoom + 'px';
    this.items.style.width = w + 'px'; this.items.style.height = hh + 'px'; this.items.style.transform = `scale(${zoom})`;
  }
  /** camera moved: shift the items layer now, repaint canvases next frame */
  redraw() {
    if (!this.canvas) return;
    this.constrain(); const cam = this.cam;
    this.items.style.transform = `translate(${-cam.x * cam.z}px,${-cam.y * cam.z}px) scale(${cam.z})`;
    if (this._raf || !this.visible) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; if (!this.visible) return; this.renderBg(); this.size('live'); this.renderInk(); });
  }
  wipe(ctx) {
    if (!this.canvas) return ctx.clearRect(0, 0, this.w, this.h);
    const c = this.cam; ctx.clearRect(c.x - 4, c.y - 4, this.vw / c.z + 8, this.vh / c.z + 8);
  }
  computeScale() {
    if (this.canvas) { this.dpr = Math.min(window.devicePixelRatio || 1, 2.5); return this.dpr; }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let s = dpr * this.zoom;
    s = Math.min(s, Math.sqrt((this.page.infinite ? 14e6 : MAX_PX) / (this.w * this.h)), 4096 / Math.max(this.w, this.h) * (this.page.infinite ? 2 : 1));
    return Math.max(0.25, s);
  }
  size(n, on = true) {
    const c = this.cv[n];
    if (this.canvas) {
      const d = this.dpr, W = on ? Math.round(this.vw * d) : 1, H = on ? Math.round(this.vh * d) : 1;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const x = this.ctx(n);
      if (on) { const k = this.cam.z * d; x.setTransform(k, 0, 0, k, -this.cam.x * k, -this.cam.y * k); }
      return x;
    }
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
    if (this.seamless) { this.renderSheet(ctx); return; }
    if (this.canvas) {
      const c = this.cam; drawCanvasBg(ctx, { x: c.x, y: c.y, w: this.vw / c.z, h: this.vh / c.z, z: c.z, paper: paperOf(note, pg), tpl: pg.bg || 'dot' });
      return;
    }
    if (pg.type === 'pdf') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.w, this.h); return; }
    drawTemplate(ctx, this.w, this.h, pg.bg || note.template || 'lined', paperOf(note, pg), pg.bg ? null : note.preset, patternOf(note, pg));
    if (pg.bgImage?.assetId) {
      const img = cachedImage(pg.bgImage.assetId) || await getImage(pg.bgImage.assetId);
      if (img && tk === this.token) { drawTemplate(ctx, this.w, this.h, 'blank', paperOf(note, pg)); drawBgImage(ctx, img, this.w, this.h, pg.bgImage.fit); }
    }
  }
  /** paint the visible pages of a seamless sheet edge to edge, with a hairline break between pages */
  renderSheet(ctx) {
    const note = this.engine.note, pg = this.page, c = this.cam, W = pg.width, H = pageH(pg), n = Math.round(pg.height / H);
    const bc = this.cv.bg; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, bc.width, bc.height); ctx.restore();
    const k0 = Math.max(0, Math.floor(c.y / H)), k1 = Math.min(n - 1, Math.floor((c.y + this.vh / c.z) / H));
    const paper = paperOf(note, pg), tpl = pg.bg || note.template || 'lined';
    ctx.save(); ctx.shadowColor = 'rgba(20,24,40,.22)'; ctx.shadowBlur = 26 * this.dpr; ctx.shadowOffsetY = 6 * this.dpr;
    ctx.fillStyle = Array.isArray(paper) ? paper[0] : paper && paper !== 'none' ? paper : '#fff'; ctx.fillRect(0, 0, W, pg.height); ctx.restore();
    for (let k = k0; k <= k1; k++) {
      ctx.save(); ctx.translate(0, k * H); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      drawTemplate(ctx, W, H, tpl, paper, pg.bg ? null : note.preset, patternOf(note, pg)); ctx.restore();
    }
    // page break guides: dashed hairline across the sheet and a small page number in the margin
    const px = 1 / c.z; ctx.save(); ctx.lineWidth = px; ctx.strokeStyle = 'rgba(79,70,229,.45)'; ctx.setLineDash([6 * px, 5 * px]);
    ctx.fillStyle = 'rgba(100,106,130,.9)'; ctx.font = `600 ${11 * px}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
    for (let k = Math.max(1, k0); k <= Math.min(n - 1, k1 + 1); k++) {
      ctx.beginPath(); ctx.moveTo(0, k * H); ctx.lineTo(W, k * H); ctx.stroke();
      const label = 'Page ' + (k + 1), tw = ctx.measureText(label).width;
      if (c.x < -tw - 14 * px) { ctx.setLineDash([]); ctx.textAlign = 'right'; ctx.fillText(label, -8 * px, k * H); ctx.setLineDash([6 * px, 5 * px]); }
      else { ctx.textAlign = 'right'; ctx.fillText(label, W - 8 * px, k * H - 9 * px); }
    }
    ctx.restore();
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
    this.wipe(ink);
    const hasHl = strokes.some((s) => !s.deleted && s.tool === 'highlighter');
    const hl = this.size('hl', hasHl);
    if (hasHl) this.wipe(hl);
    const cam = this.canvas ? this.cam : null, vx1 = cam ? cam.x + this.vw / cam.z : 0, vy1 = cam ? cam.y + this.vh / cam.z : 0;
    for (const s of strokes) {
      if (s.deleted || (skip && skip.has(s.id))) continue;
      if (cam) { const b = bboxOf(s); if (b.x1 < cam.x || b.x0 > vx1 || b.y1 < cam.y || b.y0 > vy1) continue; }
      drawStroke(s.tool === 'highlighter' ? hl : ink, s);
    }
  }
  renderItems() { if (this.visible) syncItems(this); }
  clearLive() { const c = this.cv.live, x = this.ctx('live'); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.restore(); }
  destroy() { this.token++; cancelAnimationFrame(this._raf); for (const c of Object.values(this.cv)) { c.width = 1; c.height = 1; } this.el.remove(); }
}

/** Paint a page (template + pdf + ink + images) onto ctx in page units. For thumbnails, previews and export-ish uses. */
export function paintPage(ctx, note, page, { pdfCanvas, items = true } = {}) {
  page = flattenCanvas(page);
  const w = page.width, hh = page.height;
  if (page.type === 'pdf') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); if (pdfCanvas && pdfCanvas.width > 1) ctx.drawImage(pdfCanvas, 0, 0, w, hh); }
  else {
    drawTemplate(ctx, w, hh, page.bg || note.template || 'lined', paperOf(note, page), page.bg ? null : note.preset, patternOf(note, page));
    const bi = page.bgImage && cachedImage(page.bgImage.assetId);
    if (bi) { drawTemplate(ctx, w, hh, 'blank', paperOf(note, page)); drawBgImage(ctx, bi, w, hh, page.bgImage.fit); }
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
