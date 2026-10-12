// Engine: owns note pages, zoom/scroll, pointer routing (pen/touch/mouse), gestures, history and page operations.
import { h, newId, throttle } from '../core/utils.js';
import { putAsset } from '../core/db.js';
import { toast } from '../core/store.js';
import { History } from './history.js';
import { PageView } from './pages.js';
import { cloneStroke, bboxOf, tomb, alive, drawStroke, getAuthor } from './stroke.js';
import { withData } from './items.js';
import { seedUrl } from './assets.js';
import { icon } from './icons.js';
import { pref, clamp } from './ui.js';
import { createPenTool } from './tools/pen.js';
import { createEraserTool } from './tools/eraser.js';
import { createSelectTool } from './tools/select.js';
import { createTextTool } from './tools/text.js';
import { createShapeTool } from './tools/shape.js';
import { createLaserTool } from './tools/laser.js';

export const MIN_ZOOM = 0.3, MAX_ZOOM = 4;
const lazy = (f) => { let p; return () => (p ||= f().catch((e) => { console.warn('optional module unavailable', e); return null; })); };

const DEFAULTS = {
  tool: 'pen',
  pen: { color: '#1f2937', size: 3, snap: true },
  highlighter: { color: '#fde047', size: 18, snap: true },
  pencil: { color: '#374151', size: 2 },
  eraser: { size: 14, mode: 'stroke' },
  shape: { kind: 'rect', color: '#4f46e5', size: 3 },
  text: { color: '#111827', fontSize: 20 },
};
export const DRAW_TOOLS = ['pen', 'highlighter', 'pencil', 'shape'];

export class Engine {
  constructor({ note, root, scroll, pagesEl, wrap, readOnly }) {
    this.readOnly = !!readOnly; this.opCbs = new Set(); this.presCbs = new Set(); this.peers = []; this._remote = false;
    this.note = note; this.root = root; this.scroll = scroll; this.pagesEl = pagesEl; this.wrap = wrap;
    this.listeners = {};
    this.pvs = []; this.byEl = new Map();
    this.zoom = 1; this.fit = true; this.cur = 0;
    this.media = {
      pdf: lazy(() => import('../features/pdf.js')),
      audio: lazy(() => import('../features/audio.js')),
      export: lazy(() => import('../features/export.js')),
    };
    this.media.audio().then((m) => { this.audioMod = m; });
    const saved = pref.get('tools', {});
    this.settings = {};
    for (const k of Object.keys(DEFAULTS)) this.settings[k] = typeof DEFAULTS[k] === 'object' ? { ...DEFAULTS[k], ...(saved[k] || {}) } : saved[k] || DEFAULTS[k];
    this.settings.tool = DEFAULTS.tool;
    this.recent = pref.get('recent', []);
    this.history = new History(() => { this.emit('history'); });
    this.selection = null; this.editing = null; this.ruler = null;
    this.penSeen = !!pref.get('penSeen', false); this.penDown = false; this.spaceDown = false;
    this.touches = new Map(); this.mode = null; this.activeId = null;
    this.tools = {
      pen: createPenTool(this, 'pen'), highlighter: createPenTool(this, 'highlighter'), pencil: createPenTool(this, 'pencil'),
      eraser: createEraserTool(this), select: createSelectTool(this), text: createTextTool(this),
      shape: createShapeTool(this), laser: createLaserTool(this), hand: { cursor: 'grab' },
    };
    this.io = new IntersectionObserver((es) => {
      for (const e of es) { const pv = this.byEl.get(e.target); if (pv) pv.setVisible(e.isIntersecting); }
    }, { root: scroll, rootMargin: '120% 0px 120% 0px' });
    this._bind();
    this.rebuild();
  }

  // ---- events ----
  on(evt, fn) { (this.listeners[evt] ||= new Set()).add(fn); return () => this.listeners[evt].delete(fn); }
  emit(evt, d) { this.listeners[evt]?.forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); }
  changed(pv, kind) { this.emit('change', { page: pv?.page, kind }); }

  // ---- settings / tools ----
  get tool() { return this.settings.tool; }
  cfg() { return this.settings[this.tool]; }
  saveSettings() { pref.set('tools', this.settings); }
  setTool(t) {
    if (this.readOnly) t = 'hand';
    if (t === this.settings.tool) return;
    navigator.vibrate?.(6);
    this.endEdit();
    if (this.settings.tool === 'select' && t !== 'select') this.clearSelection();
    this.tools[this.settings.tool]?.deactivate?.();
    this.settings.tool = t;
    this.tools[t]?.activate?.();
    this.root.dataset.tool = t;
    this.emit('tool', t);
  }
  set(toolName, patch) { Object.assign(this.settings[toolName], patch); this.saveSettings(); this.emit('settings', toolName); }
  useColor(c) {
    this.recent = [c, ...this.recent.filter((x) => x !== c)].slice(0, 8);
    pref.set('recent', this.recent); this.emit('settings', 'recent');
  }

  // ---- pages ----
  rebuild() {
    const st = this.scroll.scrollTop;
    this.clearSelection(true);
    for (const pv of this.pvs) { this.io.unobserve(pv.el); pv.destroy(); }
    this.pagesEl.replaceChildren(); this.byEl.clear();
    this.pvs = this.note.pages.map((p, i) => new PageView(this, p, i));
    for (const pv of this.pvs) { this.pagesEl.append(pv.el); this.byEl.set(pv.el, pv); }
    this.addBtn = h('button', { class: 'ik-addpage', type: 'button', onclick: () => this.addPage(this.pvs.length - 1) }, '+ Add page');
    this.pagesEl.append(this.addBtn);
    this.applyZoom(this.fit ? this.fitZoom() : this.zoom, null, true);
    for (const pv of this.pvs) this.io.observe(pv.el);
    this.scroll.scrollTop = st;
    this.updateCurrent(true);
    this.emit('pages');
  }
  pvOf(page) { return this.pvs.find((p) => p.page === page); }
  pvById(id) { return this.pvs.find((p) => p.page.id === id); }
  pvAtClient(x, y) {
    let best = null, bd = 1e9;
    for (const pv of this.pvs) {
      const r = pv.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pv;
      const d = Math.abs((r.top + r.bottom) / 2 - y); if (d < bd) { bd = d; best = pv; }
    }
    return best;
  }
  currentPv() { return this.pvs[this.cur] || this.pvs[0]; }
  updateCurrent(force) {
    const r = this.scroll.getBoundingClientRect(), mid = r.top + Math.min(r.height * 0.4, 300);
    let idx = 0;
    for (let i = 0; i < this.pvs.length; i++) { if (this.pvs[i].el.getBoundingClientRect().top <= mid) idx = i; }
    if (idx !== this.cur || force) {
      this.cur = idx; this.emit('page', { index: idx, count: this.pvs.length, id: this.pvs[idx]?.page.id });
    }
  }
  goToPage(i, smooth = true) {
    const pv = this.pvs[clamp(i, 0, this.pvs.length - 1)]; if (!pv) return;
    const r = pv.el.getBoundingClientRect(), s = this.scroll.getBoundingClientRect();
    this.scroll.scrollTo({ top: this.scroll.scrollTop + r.top - s.top - 12, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---- zoom ----
  fitZoom() {
    const maxW = Math.max(...this.note.pages.map((p) => p.width), 300);
    const pad = this.scroll.clientWidth < 700 ? 8 : 40;
    return clamp((this.scroll.clientWidth - pad) / maxW, MIN_ZOOM, MAX_ZOOM);
  }
  fitWidth() { this.fit = true; this.applyZoom(this.fitZoom()); }
  setZoom(z, cx, cy) { this.fit = false; this.applyZoom(z, cx == null ? null : { x: cx, y: cy }); }
  applyZoom(z, anchor, quiet) {
    z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const old = this.zoom;
    const r = this.scroll.getBoundingClientRect();
    const ax = anchor ? anchor.x : r.left + r.width / 2, ay = anchor ? anchor.y : r.top + r.height / 2;
    const apv = this.pvs.length && !quiet ? this.pvAtClient(ax, ay) : null;
    let ox = 0, oy = 0;
    if (apv) { const b = apv.el.getBoundingClientRect(); ox = (ax - b.left) / old; oy = (ay - b.top) / old; }
    this.zoom = z;
    for (const pv of this.pvs) pv.layout(z);
    if (apv) { const b = apv.el.getBoundingClientRect(); this.scroll.scrollLeft += b.left + ox * z - ax; this.scroll.scrollTop += b.top + oy * z - ay; }
    this._settle();
    this.renderSelection(); if (this.peers.length) this.renderPresence();
    this.emit('zoom', z);
  }
  _settle = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { for (const pv of this.pvs) pv.rescale(); this.renderSelection(); }, 140); }; })();
  onResize() { if (this.fit) this.applyZoom(this.fitZoom(), null, true); }

  // ---- history helpers ----
  snap(pv) { return { strokes: pv.page.strokes.slice(), items: pv.page.items.slice() }; }
  commit(pv, before) {
    const after = this.snap(pv);
    { const au = getAuthor(); for (const k of ['strokes', 'items']) { const ids = new Set(before[k].map((x) => x.id)); for (const x of after[k]) if (!ids.has(x.id) && !x.by) x.by = au; } }
    const ch = this._diff(before, after);
    if (!ch.length) return false;
    const page = pv.page;
    this.history.push({ undo: () => this._applyCh(page, ch, 'undo'), redo: () => this._applyCh(page, ch, 'redo') });
    this.emitOps(page, ch, 'redo');
    this.changed(pv, 'edit');
    return true;
  }
  _diff(b, a) {
    const out = [];
    for (const k of ['strokes', 'items']) {
      const bm = new Map(b[k].map((x) => [x.id, x])), am = new Set(a[k].map((x) => x.id));
      for (const x of a[k]) { const o = bm.get(x.id); if (o !== x) out.push({ k, id: x.id, b: o || null, a: x }); }
      for (const o of b[k]) if (!am.has(o.id)) out.push({ k, id: o.id, b: o, a: tomb(o) });
    }
    return out;
  }
  _target(c, dir) { const t = dir === 'undo' ? c.b || tomb(c.a) : c.a; return t.deleted ? t : { ...t, u: Date.now() }; }
  _applyCh(page, ch, dir) {
    for (const k of ['strokes', 'items']) {
      const list = page[k].slice(); let any = false;
      for (const c of ch) {
        if (c.k !== k) continue; any = true;
        const t = this._target(c, dir), i = list.findIndex((x) => x.id === c.id);
        if (i >= 0) list[i] = t; else list.push(t);
      }
      if (any) page[k] = list;
    }
    const pv = this.pvOf(page);
    if (pv) { pv.renderInk(); pv.renderItems(); }
    if (this.selection) this.pruneSelection();
    this.emitOps(page, ch, dir);
    this.changed(pv, 'history');
  }
  // ---- collaboration hooks ----
  onLocalOp(cb) { this.opCbs.add(cb); return () => this.opCbs.delete(cb); }
  emitOps(page, ch, dir) {
    if (this._remote || !this.opCbs.size) return;
    const ops = ch.map((c) => {
      const t = this._target(c, dir);
      if (c.k === 'strokes') return t.deleted ? { type: 'stroke-del', pageId: page.id, data: { id: t.id } } : { type: 'stroke-add', pageId: page.id, data: t };
      return t.deleted ? { type: 'item-del', pageId: page.id, data: { id: t.id } } : { type: 'item-upsert', pageId: page.id, data: t };
    });
    this.opCbs.forEach((cb) => { try { cb(ops); } catch (e) { console.error(e); } });
  }
  _upsert(list, r) {
    const i = list.findIndex((x) => x.id === r.id);
    if (i < 0) { list.push(r); return 'add'; }
    const l = list[i];
    if (l.deleted) { if (!r.deleted && (r.u || 0) > (l.u || 0)) { list[i] = r; return 'set'; } return null; }
    if (r.deleted || (r.u || 0) > (l.u || 0)) { list[i] = r; return 'set'; }
    return null;
  }
  /** apply ops from the live session layer: {type, pageId, data} */
  applyRemoteOps(ops) {
    const touched = new Map(); let structural = false;
    for (const op of ops || []) {
      let page = this.note.pages.find((p) => p.id === op.pageId);
      if (op.type === 'page-add') {
        if (!page && op.data) {
          const np = { strokes: [], items: [], ...op.data }; const at = op.data.index ?? this.note.pages.length;
          this.note.pages.splice(Math.min(at, this.note.pages.length), 0, np); structural = true;
        }
        continue;
      }
      if (!page) continue;
      const d = op.data || {}; const t = touched.get(page) || { added: [], full: false }; touched.set(page, t);
      if (op.type === 'stroke-add') {
        const list = page.strokes.slice(), r = this._upsert(list, d);
        if (r) { page.strokes = list; if (r === 'add' && !d.deleted && d.tool !== 'highlighter') t.added.push(d); else t.full = true; }
      } else if (op.type === 'stroke-del') {
        const list = page.strokes.slice(); const r = this._upsert(list, { id: d.id, tool: 'pen', size: 1, pts: [], deleted: true, u: Date.now() });
        if (r) { page.strokes = list; t.full = true; }
      } else if (op.type === 'item-upsert' || op.type === 'item-del') {
        if (this.editing && this.editing.id === d.id) continue;
        const list = page.items.slice(), ex = list.find((x) => x.id === d.id), r = this._upsert(list, op.type === 'item-del' ? { ...tomb(ex || { id: d.id, type: 'text', x: 0, y: 0, w: 1, h: 1 }), u: Date.now() } : d);
        if (r) { page.items = list; t.items = true; }
      } else if (op.type === 'text') this.emit('remoteText', d);
    }
    this._renderRemote(touched, structural);
  }
  _renderRemote(touched, structural) {
    if (structural) { if (this.mode === 'tool') setTimeout(() => this.rebuild(), 300); else this.rebuild(); this.changed(null, 'pages'); return; }
    for (const [page, t] of touched) {
      const pv = this.pvOf(page); if (!pv) continue;
      if (t.full) {
        if (this.mode === 'tool' && this.activePv === pv) pv._dirtyInk = true; else pv.renderInk();
      } else if (t.added.length && pv.visible) {
        const c = pv.ctx('ink'); for (const s of t.added) drawStroke(c, s);
        this.flash(pv, t.added);
      }
      if (t.items || t.full) pv.renderItems();
      this.changed(pv, 'remote');
    }
    if (this.selection) this.pruneSelection();
  }
  /** merge a full remote copy of the note (arrives via notes:changed {remote:true}) */
  mergeRemoteNote(rn) {
    if (!rn || !rn.pages) return;
    const note = this.note, byId = new Map(note.pages.map((p) => [p.id, p]));
    let prev = null, structural = false; const touched = new Map();
    for (const rp of rn.pages) {
      let lp = byId.get(rp.id);
      if (!lp) {
        lp = { ...rp, strokes: rp.strokes || [], items: rp.items || [] }; byId.set(lp.id, lp);
        note.pages.splice(prev ? note.pages.indexOf(prev) + 1 : 0, 0, lp); structural = true;
      } else {
        const t = { added: [], full: false, items: false };
        for (const k of ['strokes', 'items']) {
          const list = lp[k].slice(); let ch = false;
          for (const r of rp[k] || []) {
            const res = this._upsert(list, r);
            if (res) { ch = true; if (k === 'strokes') { if (res === 'add' && !r.deleted && r.tool !== 'highlighter') t.added.push(r); else t.full = true; } else t.items = true; }
          }
          if (ch) lp[k] = list;
        }
        if (t.added.length || t.full || t.items) touched.set(lp, t);
      }
      prev = lp;
    }
    if (rn.recordings?.length) {
      const have = new Set((note.recordings || []).map((r) => r.id));
      note.recordings = [...(note.recordings || []), ...rn.recordings.filter((r) => !have.has(r.id))];
    }
    this._renderRemote(touched, structural);
  }
  flash(pv, strokes) {
    if (this.mode === 'tool' && this.activePv === pv) return;
    const peer = this.peers.find((p) => p.id === strokes[0]?.by), col = peer?.color || '#4f46e5', cv = pv.cv.live, ctx = pv.ctx('live');
    if (cv.width < 2) return;
    pv.clearLive(); ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 14;
    for (const s of strokes) drawStroke(ctx, { ...s, color: col, tool: 'pen' });
    ctx.restore(); cv.style.transition = 'none'; cv.style.opacity = '.75';
    requestAnimationFrame(() => requestAnimationFrame(() => { cv.style.transition = 'opacity .8s'; cv.style.opacity = '0'; }));
    clearTimeout(pv._ft); pv._ft = setTimeout(() => { if (!(this.mode === 'tool' && this.activePv === pv)) pv.clearLive(); cv.style.opacity = ''; cv.style.transition = ''; }, 900);
  }
  setPresence(peers) { this.peers = peers || []; this.renderPresence(); }
  onLocalPresence(cb) { this.presCbs.add(cb); return () => this.presCbs.delete(cb); }
  renderPresence() {
    for (const pv of this.pvs) {
      if (!pv.pres) { pv.pres = h('div', { class: 'ik-pres' }); pv.el.append(pv.pres); }
      pv.pres.replaceChildren();
    }
    for (const p of this.peers) {
      const pv = this.pvById(p.pageId); if (!pv || p.x == null) continue;
      const c = h('div', { class: 'ik-peer' + (p.laser ? ' laser' : ''), style: { transform: `translate(${p.x * this.zoom}px,${p.y * this.zoom}px)`, '--pc': p.color || '#ef4444' } },
        h('i', { class: 'cur' }), h('span', {}, p.name || ''));
      pv.pres.append(c);
    }
  }
  _hover(e) {
    const el = e.target.closest?.('.ik-page'); const pv = el && this.byEl.get(el);
    const now = performance.now(); if (now - (this._pt || 0) < 70) return; this._pt = now;
    if (!pv) return;
    const r = pv.el.getBoundingClientRect();
    const m = { pageId: pv.page.id, x: Math.round((e.clientX - r.left) / this.zoom), y: Math.round((e.clientY - r.top) / this.zoom) };
    this.presCbs.forEach((cb) => cb(m));
  }

  undo() { this.endEdit(); this.tools[this.tool]?.cancel?.(); this.history.undo(); }
  redo() { this.endEdit(); this.history.redo(); }
  addStroke(pv, stroke, render = true) {
    const m = this.audioMod;
    if (m) { try { const rec = m.getActiveRecorder(this.note.id); if (rec) m.stampStroke(stroke, rec); } catch { /* ignore */ } }
    const before = this.snap(pv);
    pv.page.strokes = [...pv.page.strokes, stroke];
    this.commit(pv, before);
    if (render) pv.renderInk();
  }
  addItem(pv, item, select = true) {
    const before = this.snap(pv);
    pv.page.items = [...pv.page.items, withData(item)];
    this.commit(pv, before); pv.renderItems();
    if (select) this.tools.select.selectItems?.(pv, [item.id]);
  }
  itemAt(pv, x, y) {
    const items = pv.page.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].deleted) continue;
      const it = items[i], el = pv.items.querySelector(`[data-id="${it.id}"]`);
      const hh = it.type === 'text' && el ? Math.max(it.h, el.offsetHeight) : it.h;
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + hh) return it;
    }
    return null;
  }

  // ---- selection (state lives here, behavior in tools/select.js) ----
  clearSelection(quiet) {
    if (!this.selection) return;
    const pv = this.selection.pv; this.selection = null;
    pv.sel.replaceChildren(); if (!quiet) this.emit('selection', null);
  }
  pruneSelection() {
    const s = this.selection; if (!s) return;
    const ids = new Set(alive(s.pv.page.strokes).map((x) => x.id)), iids = new Set(alive(s.pv.page.items).map((x) => x.id));
    for (const i of [...s.strokes]) if (!ids.has(i)) s.strokes.delete(i);
    for (const i of [...s.items]) if (!iids.has(i)) s.items.delete(i);
    if (!s.strokes.size && !s.items.size) this.clearSelection(); else this.renderSelection();
  }
  renderSelection() { this.tools.select.renderUI?.(); }

  // ---- text editing ----
  startEdit(pv, id, before) {
    this.endEdit();
    let el = pv.items.querySelector(`[data-id="${id}"]`);
    if (!el) { pv.renderItems(); el = pv.items.querySelector(`[data-id="${id}"]`); }
    if (!el) return;
    const isNew = !!before;
    this.clearSelection();
    const t = el.firstChild;
    el.classList.add('ik-editing'); el.setAttribute('data-ik-ui', '');
    t.contentEditable = 'true'; t.spellcheck = true;
    t.focus({ preventScroll: true });
    const sel = getSelection(); sel.selectAllChildren(t); sel.collapseToEnd();
    const ed = { pv, id, el, t, before: before || this.snap(pv), isNew };
    this.editing = ed;
    t.onblur = () => { if (document.hasFocus()) setTimeout(() => { if (this.editing === ed) this.endEdit(); }, 60); };
    t.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.endEdit(); } e.stopPropagation(); };
    t.onpaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };
    this.emit('edit', ed);
  }
  endEdit() {
    const ed = this.editing; if (!ed) return;
    this.editing = null;
    const { pv, id, el, t } = ed;
    const html = t.innerHTML, text = (t.innerText || '').replace(/ /g, ' ').trimEnd();
    t.contentEditable = 'false'; t.onblur = t.onkeydown = t.onpaste = null;
    el.classList.remove('ik-editing'); el.removeAttribute('data-ik-ui');
    const it = pv.page.items.find((x) => x.id === id);
    if (it) {
      if (!text.trim()) {
        pv.page.items = ed.isNew ? pv.page.items.filter((x) => x.id !== id) : pv.page.items.map((x) => (x.id === id ? tomb(x) : x));
        if (!ed.isNew) this.commit(pv, ed.before);
        pv.renderItems();
      } else if (html !== it.html) {
        const fs = parseFloat(t.style.fontSize) || it.fontSize, col = t.style.color || it.color;
        const n = withData({ ...it, html, text, fontSize: fs, color: col, font: t.style.fontFamily || it.font, align: t.style.textAlign || it.align, h: Math.max(it.h, Math.ceil(el.offsetHeight)) });
        pv.page.items = pv.page.items.map((x) => (x === it ? n : x));
        t._html = html;
        this.commit(pv, ed.before);
      } else if (ed.isNew) pv.renderItems();
    }
    this.emit('edit', null);
  }
  /** apply rich-text command to the text box being edited */
  fmt(cmd, val) {
    if (!this.editing) return false;
    this.editing.t.focus(); document.execCommand(cmd, false, val); return true;
  }

  // ---- inserting media ----
  visibleCenter(pv) {
    const r = pv.el.getBoundingClientRect(), s = this.scroll.getBoundingClientRect();
    const top = Math.max(r.top, s.top), bot = Math.min(r.bottom, s.bottom), l = Math.max(r.left, s.left), rr = Math.min(r.right, s.right);
    return { x: ((l + rr) / 2 - r.left) / this.zoom, y: ((top + bot) / 2 - r.top) / this.zoom };
  }
  async insertImage(file, pv = this.currentPv(), at) {
    if (!file || !pv) return;
    try {
      const bmp = await createImageBitmap(file);
      let blob = file, w = bmp.width, hh = bmp.height;
      const M = 2200;
      if (Math.max(w, hh) > M || file.size > 2.5e6) {
        const k = Math.min(1, M / Math.max(w, hh)); const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(hh * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const png = file.type === 'image/png';
        blob = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.88));
      }
      bmp.close?.();
      const rec = await putAsset({ noteId: this.note.id, kind: 'image', blob, mime: blob.type });
      seedUrl(rec.id, blob);
      const dw = Math.min(w, pv.w * 0.6, 520), dh = dw * (hh / w);
      const c = at || this.visibleCenter(pv);
      this.addItem(pv, { id: newId(), type: 'image', assetId: rec.id, x: clamp(c.x - dw / 2, 0, pv.w - dw), y: clamp(c.y - dh / 2, 0, Math.max(0, pv.h - dh)), w: dw, h: dh, rotation: 0 });
      this.setTool('select');
    } catch (e) { console.warn(e); toast('Could not add that image'); }
  }
  insertSticker(emoji, pv = this.currentPv()) {
    const c = this.visibleCenter(pv), s = 90;
    this.addItem(pv, { id: newId(), type: 'sticker', emoji, x: c.x - s / 2, y: c.y - s / 2, w: s, h: s, rotation: 0 });
    this.setTool('select');
  }
  insertTextBox(pv, x, y, html = '', text = '', extra = {}) {
    const fs = this.settings.text.fontSize, col = this.settings.text.color;
    const it = withData({ id: newId(), type: 'text', x, y, w: 280, h: Math.round(fs * 1.6), rotation: 0, html, text, fontSize: fs, color: col, font: this.settings.text.font, ...extra });
    const before = this.snap(pv);
    pv.page.items = [...pv.page.items, it]; pv.renderItems();
    this.startEdit(pv, it.id, before);
    return it;
  }

  insertSticky(color = '#fde68a') {
    const pv = this.currentPv(), c = this.visibleCenter(pv);
    const it = this.insertTextBox(pv, c.x - 110, c.y - 100, '', '', { w: 220, h: 200, bg: color, sticky: true, color: '#1f2937' });
    return it;
  }
  showRadial(cx, cy) {
    this.hideRadial();
    const r = this.wrap.getBoundingClientRect(), ring = h('div', { class: 'ik-radial', 'data-ik-ui': '', style: { left: cx - r.left + 'px', top: cy - r.top + 'px' } });
    const list = ['pen', 'highlighter', 'eraser', 'select', 'text', 'shape', 'laser', 'hand'];
    list.forEach((t, i) => {
      const a = (i / list.length) * 6.2832 - 1.5708, b = h('button', { type: 'button', title: t, 'aria-label': t, style: { left: Math.cos(a) * 78 + 'px', top: Math.sin(a) * 78 + 'px', animationDelay: i * 18 + 'ms' } });
      b.append(icon(t, 22)); b.addEventListener('click', () => { this.setTool(t); this.hideRadial(); });
      ring.append(b);
    });
    this.wrap.append(ring); this._radial = ring; navigator.vibrate?.(10);
    this._radialOff = (e) => { if (!ring.contains(e.target)) this.hideRadial(); };
    setTimeout(() => document.addEventListener('pointerdown', this._radialOff, true), 0);
  }
  hideRadial() { this._radial?.remove(); this._radial = null; document.removeEventListener('pointerdown', this._radialOff, true); }

  // ---- page operations ----
  _pagesCmd(fn, recordProps) {
    const note = this.note, before = note.pages.slice();
    const props = recordProps ? recordProps() : [];
    fn();
    const after = note.pages.slice();
    const undoProps = props.map(([o, k]) => [o, k, o[k]]); // placeholder (values restored below)
    void undoProps;
    return { before, after };
  }
  _structural(mut) {
    const note = this.note, bPages = note.pages.slice();
    const bT = { template: note.template, paperColor: note.paperColor };
    const props = []; // [obj,key,old,new]
    const setProp = (o, k, v) => { props.push([o, k, o[k], v]); if (v === undefined) delete o[k]; else o[k] = v; };
    mut(setProp);
    const aPages = note.pages.slice();
    const redo = () => { note.pages = aPages.slice(); props.forEach(([o, k, , v]) => (v === undefined ? delete o[k] : (o[k] = v))); this.rebuild(); this.changed(null, 'pages'); };
    const undo = () => { note.pages = bPages.slice(); [...props].reverse().forEach(([o, k, v]) => (v === undefined ? delete o[k] : (o[k] = v))); this.rebuild(); this.changed(null, 'pages'); };
    void bT;
    this.history.push({ undo, redo });
    this.rebuild(); this.changed(null, 'pages');
  }
  newPage(like) {
    const base = like || this.note.pages.filter((p) => p.type === 'draw').pop() || this.note.pages[0];
    return { id: newId(), type: 'draw', width: base?.width || 820, height: base?.height || 1160, strokes: [], items: [] };
  }
  addPage(after = this.cur, opts = {}) {
    const at = clamp(after + 1, 0, this.note.pages.length);
    const pg = { ...this.newPage(), ...opts };
    this._structural((set) => { void set; this.note.pages.splice(at, 0, pg); });
    this.opCbs.forEach((cb) => cb([{ type: 'page-add', pageId: pg.id, data: { ...pg, index: at } }]));
    requestAnimationFrame(() => this.goToPage(at));
    return pg;
  }
  deletePage(i) {
    if (this.note.pages.length <= 1) { toast('A note needs at least one page'); return; }
    this._structural(() => { this.note.pages.splice(i, 1); });
  }
  duplicatePage(i) {
    const p = this.note.pages[i];
    const copy = { ...p, id: newId(), strokes: alive(p.strokes).map((s) => cloneStroke(s)), items: alive(p.items).map((x) => withData({ ...x, id: newId() })) };
    this._structural(() => { this.note.pages.splice(i + 1, 0, copy); });
  }
  movePage(i, to) {
    to = clamp(to, 0, this.note.pages.length - 1); if (to === i) return;
    this._structural(() => { const [p] = this.note.pages.splice(i, 1); this.note.pages.splice(to, 0, p); });
  }
  setTemplate(i, tpl) {
    this._structural((set) => {
      if (i === 'all') { set(this.note, 'template', tpl); for (const p of this.note.pages) if (p.bg) set(p, 'bg', undefined); }
      else set(this.note.pages[i], 'bg', tpl);
    });
  }
  setPaper(color) { this._structural((set) => set(this.note, 'paperColor', color)); }
  async setBgImage(i, file, fit = 'contain') {
    const pg = this.note.pages[i]; if (!pg) return;
    if (!file) return this._structural((set) => set(pg, 'bgImage', undefined));
    const rec = await putAsset({ noteId: this.note.id, kind: 'image', blob: file, mime: file.type });
    seedUrl(rec.id, file);
    this._structural((set) => set(pg, 'bgImage', { assetId: rec.id, fit }));
  }
  setBgFit(i, fit) { const pg = this.note.pages[i]; if (pg?.bgImage) this._structural((set) => set(pg, 'bgImage', { ...pg.bgImage, fit })); }
  /** replace all pages (version restore / pdf import reload) */
  replacePages(pages, extra = {}) {
    this.endEdit(); this.note.pages = pages; Object.assign(this.note, extra);
    this.history.clear(); this.rebuild(); this.changed(null, 'pages');
  }

  // ---- ruler snapping ----
  applyRuler(pt) {
    const r = this.ruler; if (!r || !r.on) return pt;
    const wr = this.wrap.getBoundingClientRect();
    const px = pt.cx - wr.left, py = pt.cy - wr.top;
    const ux = Math.cos(r.a), uy = Math.sin(r.a);
    const dx = px - r.x, dy = py - r.y;
    const dist = dx * -uy + dy * ux; // signed distance to line
    if (!pt.latched && Math.abs(dist) > 26) return pt;
    const t = dx * ux + dy * uy;
    if (Math.abs(t) > r.len / 2 + 30 && !pt.latched) return pt;
    const sx = r.x + ux * t, sy = r.y + uy * t;
    const org = pt.pv._org, z = this.zoom;
    pt.cx = sx + wr.left; pt.cy = sy + wr.top;
    pt.x = (pt.cx - (org.left - (this.scroll.scrollLeft - org.sl))) / z;
    pt.y = (pt.cy - (org.top - (this.scroll.scrollTop - org.st))) / z;
    pt.snapped = true; return pt;
  }

  // ---- pointer input ----
  _bind() {
    const s = this.scroll;
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); this._offs.push(() => t.removeEventListener(ev, fn, o)); };
    this._offs = [];
    on(s, 'pointerdown', (e) => this._down(e));
    on(s, 'pointermove', (e) => this._move(e));
    on(s, 'pointerup', (e) => this._up(e));
    on(s, 'pointercancel', (e) => this._up(e, true));
    on(s, 'pointerleave', () => this._hideCursor());
    on(s, 'contextmenu', (e) => { e.preventDefault(); if (!this.readOnly) this.showRadial(e.clientX, e.clientY); });
    on(s, 'wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    }, { passive: false });
    on(s, 'scroll', throttle(() => { this.updateCurrent(); this.renderSelection(); }, 80), { passive: true });
    on(document, 'keyup', (e) => { if (e.key === ' ') { this.spaceDown = false; this.root.classList.remove('ik-space'); } });
  }
  destroyInput() { this._offs.forEach((f) => f()); this._offs = []; }

  _mk(e, pv) {
    const org = pv._org;
    const cx = e.clientX, cy = e.clientY;
    const x = (cx - (org.left - (this.scroll.scrollLeft - org.sl))) / this.zoom;
    const y = (cy - (org.top - (this.scroll.scrollTop - org.st))) / this.zoom;
    let p = e.pressure;
    if (e.pointerType === 'mouse' || !p) p = 0.5;
    return { pv, x, y, p, e, cx, cy, type: e.pointerType, t: e.timeStamp };
  }
  _org(pv) { const r = pv.el.getBoundingClientRect(); pv._org = { left: r.left, top: r.top, sl: this.scroll.scrollLeft, st: this.scroll.scrollTop }; }
  _tool() { return this.tempTool || this.settings.tool; }

  _down(e) {
    const tg = e.target;
    if (this.readOnly) { if (!tg.closest?.('[data-ik-ui]')) this._startPan(e); return; }
    if (tg.closest?.('[data-ik-ui]') && !tg.closest('[data-handle]')) return;
    if (this.editing && !tg.closest('.ik-editing')) this.endEdit();
    if (e.pointerType === 'pen') { if (!this.penSeen) { this.penSeen = true; pref.set('penSeen', true); this.emit('penseen'); } this.penDown = true; }
    const tool = this.settings.tool;
    if (e.pointerType === 'touch') {
      if (this.penDown) return;                        // palm while the pen is down
      if (e.width > 70 && e.height > 70 && this.penSeen) return; // big contact = palm
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.touches.size === 2) { this._startGesture(); try { this.scroll.setPointerCapture(e.pointerId); } catch { /* ignore */ } e.preventDefault(); return; }
      if (this.touches.size === 3) { this.mode = 'three'; this.three = { x: [...this.touches.values()].reduce((a, t) => a + t.x, 0) / 3, d: 0 }; return; }
      if (this.touches.size > 3) return;
      const fingerPans = tool === 'hand' || (this.penSeen && !['select', 'text'].includes(tool));
      if (fingerPans) { this._startPan(e); return; }
    } else if (e.pointerType === 'mouse') {
      if (e.button === 1 || this.spaceDown || tool === 'hand') { this._startPan(e); e.preventDefault(); return; }
      if (e.button !== 0) return;
    } else if (tool === 'hand') { this._startPan(e); return; }
    this.tempTool = e.pointerType === 'pen' && (e.buttons & 32) ? 'eraser' : null;
    const pv = tg.closest?.('.ik-page') ? this.byEl.get(tg.closest('.ik-page')) : null;
    if (!pv) { return; }
    const tl = this.tools[this._tool()]; if (!tl?.down) return;
    this._org(pv); this.activePv = pv; this.activeId = e.pointerId; this.mode = 'tool';
    try { this.scroll.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    this.lastClient = { x: e.clientX, y: e.clientY };
    tl.down(this._mk(e, pv));
    clearTimeout(this._lp);
    if (['select', 'text', 'laser'].includes(this._tool()) && !e.target.closest?.('[data-handle]')) {
      const x0 = e.clientX, y0 = e.clientY;
      this._lp = setTimeout(() => {
        if (this.mode !== 'tool' || Math.hypot(this.lastClient.x - x0, this.lastClient.y - y0) > 8) return;
        tl.cancel?.(); this.mode = null; this.activeId = null; this._autoscrollStop(); this.showRadial(x0, y0);
      }, 600);
    }
    this._autoscrollStart();
  }
  _move(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId); const dx = e.clientX - t.x, dy = e.clientY - t.y;
      t.x = e.clientX; t.y = e.clientY;
      if (this.mode === 'gesture') { this._gestureMove(); e.preventDefault(); return; }
      if (this.mode === 'three') { this.three.d = [...this.touches.values()].reduce((a, q) => a + q.x, 0) / this.touches.size - this.three.x; return; }
      if (this.mode === 'pan') { this.scroll.scrollLeft -= dx; this.scroll.scrollTop -= dy; return; }
    }
    if (this.mode === 'pan' && e.pointerId === this.panId) {
      this.scroll.scrollLeft -= e.clientX - this.panLast.x; this.scroll.scrollTop -= e.clientY - this.panLast.y;
      this.panLast = { x: e.clientX, y: e.clientY }; return;
    }
    if (this.mode === 'tool' && e.pointerId === this.activeId) {
      const tl = this.tools[this._tool()], pv = this.activePv;
      this.lastClient = { x: e.clientX, y: e.clientY };
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of evs.length ? evs : [e]) tl.move?.(this._mk(c, pv));
      if (tl.predict) {
        const pr = e.getPredictedEvents ? e.getPredictedEvents() : [];
        tl.predict(pr.map((c) => this._mk(c, pv)));
      }
      this._cursor(e);
      return;
    }
    if (!this.mode) { this._cursor(e); }
    if (this.presCbs.size) this._hover(e);
  }
  _up(e, cancel) {
    clearTimeout(this._lp);
    if (e.pointerType === 'pen') this.penDown = false;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (this.mode === 'gesture') {
        if (this.touches.size < 2) {
          const g = this.gesture;
          if (!cancel && g && !g.moved && performance.now() - g.t0 < 380) this.undo();
          this.mode = this.touches.size ? 'gesture-end' : null; this.gesture = null;
        }
        return;
      }
      if (this.mode === 'three') {
        if (this.touches.size === 0) { const d = this.three.d; if (d < -60) this.undo(); else if (d > 60) this.redo(); this.mode = null; }
        return;
      }
      if (this.mode === 'gesture-end') { if (!this.touches.size) this.mode = null; return; }
      if (this.mode === 'pan') { this.mode = null; return; }
    }
    if (this.mode === 'pan' && e.pointerId === this.panId) { this.mode = null; this.root.classList.remove('ik-panning'); return; }
    if (this.mode === 'tool' && e.pointerId === this.activeId) {
      const tl = this.tools[this._tool()], pv = this.activePv;
      this.mode = null; this.activeId = null; this._autoscrollStop();
      if (cancel) tl.cancel?.(); else tl.up?.(this._mk(e, pv));
      this.tempTool = null;
      for (const pv of this.pvs) if (pv._dirtyInk) { pv._dirtyInk = false; pv.renderInk(); }
    }
  }
  _startPan(e) {
    this.mode = 'pan'; this.panId = e.pointerId; this.panLast = { x: e.clientX, y: e.clientY };
    try { this.scroll.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.root.classList.add('ik-panning');
  }
  _startGesture() {
    if (this.mode === 'tool') { this.tools[this._tool()]?.cancel?.(); this._autoscrollStop(); this.activeId = null; }
    this.mode = 'gesture';
    const [a, b] = [...this.touches.values()];
    this.gesture = { t0: performance.now(), moved: false, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), sx: [a.sx, b.sx], sy: [a.sy, b.sy] };
  }
  _gestureMove() {
    const g = this.gesture; if (!g) return;
    const [a, b] = [...this.touches.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!g.moved && (Math.hypot(a.x - a.sx, a.y - a.sy) > 14 || Math.hypot(b.x - b.sx, b.y - b.sy) > 14)) g.moved = true;
    if (!g.moved) return;
    this.scroll.scrollLeft -= cx - g.cx; this.scroll.scrollTop -= cy - g.cy;
    if (g.d > 10 && d > 10) this.setZoom(this.zoom * (d / g.d), cx, cy);
    g.cx = cx; g.cy = cy; g.d = d;
  }
  _cursor(e) {
    const c = this.cursorEl;
    if (!c) return;
    if (e.pointerType === 'touch' || this._tool() !== 'eraser') { c.style.display = 'none'; return; }
    const r = this.wrap.getBoundingClientRect(), d = this.settings.eraser.size * 2 * this.zoom;
    c.style.display = 'block'; c.style.width = c.style.height = d + 'px';
    c.style.transform = `translate(${e.clientX - r.left - d / 2}px,${e.clientY - r.top - d / 2}px)`;
  }
  _hideCursor() { if (this.cursorEl) this.cursorEl.style.display = 'none'; }

  // auto-scroll when drawing near the viewport edge
  _autoscrollStart() {
    if (this._asRaf) return;
    const tick = () => {
      this._asRaf = 0;
      if (this.mode !== 'tool' || !this.lastClient || !DRAW_TOOLS.concat(['eraser', 'select']).includes(this._tool())) return;
      const r = this.scroll.getBoundingClientRect(), { x, y } = this.lastClient, E = 36;
      let dx = 0, dy = 0;
      if (y > r.bottom - E) dy = (y - (r.bottom - E)) / 3; else if (y < r.top + E) dy = -(r.top + E - y) / 3;
      if (x > r.right - E) dx = (x - (r.right - E)) / 3; else if (x < r.left + E) dx = -(r.left + E - x) / 3;
      dx = clamp(dx, -18, 18); dy = clamp(dy, -18, 18);
      if (dx || dy) {
        const b = [this.scroll.scrollLeft, this.scroll.scrollTop];
        this.scroll.scrollLeft += dx; this.scroll.scrollTop += dy;
        if (b[0] !== this.scroll.scrollLeft || b[1] !== this.scroll.scrollTop) {
          const pv = this.activePv, tl = this.tools[this._tool()];
          tl.move?.(this._mk({ clientX: x, clientY: y, pressure: 0.5, pointerType: 'mouse', timeStamp: performance.now() }, pv));
        }
      }
      this._asRaf = requestAnimationFrame(tick);
    };
    this._asRaf = requestAnimationFrame(tick);
  }
  _autoscrollStop() { cancelAnimationFrame(this._asRaf); this._asRaf = 0; }

  destroy() {
    this.endEdit(); this.destroyInput(); this._autoscrollStop();
    this.io.disconnect(); this.tools.laser.destroy?.();
    for (const pv of this.pvs) pv.destroy();
    this.listeners = {};
  }
}
void bboxOf;
