// Lasso / select tool: select strokes + items, move, resize, copy/paste, delete, recolor, convert text.
import { h, newId } from '../../core/utils.js';
import { bboxOf, strokeHit, polyContains, xformStroke, cloneStroke, drawStroke, tomb, alive } from '../stroke.js';
import { itemRect, withData } from '../items.js';
import { icon } from '../icons.js';
import { toast } from '../../core/store.js';

export const clipboard = { data: null, n: 0 };

export function createSelectTool(engine) {
  let mode = null, pv = null, start = null, before = null, orig = null, box0 = null, handle = '', moved = false, lasso = [], tapStroke = null, lastTap = { id: null, t: 0 };

  const S = () => engine.selection;
  function selBox() {
    const s = S(); if (!s) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const st of s.pv.page.strokes) if (!st.deleted && s.strokes.has(st.id)) { const b = bboxOf(st); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    for (const it of s.pv.page.items) if (!it.deleted && s.items.has(it.id)) { const r = itemRect(s.pv, it); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    return x0 > x1 ? null : { x0, y0, x1, y1 };
  }
  function select(p, strokes, items) {
    if (S() && S().pv !== p) engine.clearSelection(true);
    engine.selection = { pv: p, strokes: new Set(strokes), items: new Set(items) };
    api.renderUI(); engine.emit('selection', engine.selection);
  }
  function begin() {
    before = engine.snap(pv);
    const s = S();
    orig = { strokes: new Map(), items: new Map() };
    for (const st of before.strokes) if (s.strokes.has(st.id)) orig.strokes.set(st.id, st);
    for (const it of before.items) if (s.items.has(it.id)) orig.items.set(it.id, it);
    box0 = selBox(); moved = false;
  }
  let raf = 0;
  function apply(f, kx, ky, dx = 0, dy = 0, ax = 0, ay = 0) {
    const page = pv.page, ns = new Map();
    page.strokes = before.strokes.map((st) => {
      const o = orig.strokes.get(st.id); if (!o) return st;
      const n = xformStroke(o, f, Math.sqrt(Math.abs(kx * ky)) || 1); ns.set(st.id, n); return n;
    });
    page.items = before.items.map((it) => {
      const o = orig.items.get(it.id); if (!o) return it;
      return handle ? withData({ ...o, x: ax + (o.x - ax) * kx, y: ay + (o.y - ay) * ky, w: o.w * kx, h: o.h * ky })
        : withData({ ...o, x: o.x + dx, y: o.y + dy });
    });
    if (!moved) { moved = true; pv.renderInk(new Set(orig.strokes.keys())); }
    const live = pv.ctx('live'); pv.clearLive();
    for (const st of ns.values()) drawStroke(live, st);
    pv.renderItems();
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; api.renderUI(); });
  }
  function inBox(b, x, y, pad) { return b && x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad; }

  const api = {
    cursor: 'default',
    deactivate() { engine.clearSelection(); },
    selectItems(p, ids) { select(p, [], ids); },
    down(pt) {
      pv = pt.pv; start = pt; moved = false; tapStroke = null; handle = '';
      const hd = pt.e.target.closest?.('[data-handle]')?.dataset.handle;
      if (hd && S()) { mode = 'resize'; handle = hd; begin(); return; }
      const sel = S(), z = engine.zoom, r = 10 / z;
      const it = engine.itemAt(pv, pt.x, pt.y);
      let hs = null;
      for (let i = pv.page.strokes.length - 1; i >= 0; i--) if (strokeHit(pv.page.strokes[i], pt.x, pt.y, r)) { hs = pv.page.strokes[i]; break; }
      if (sel && sel.pv === pv && inBox(selBox(), pt.x, pt.y, 4)) { mode = 'move'; tapStroke = hs; begin(); return; }
      const target = it || hs;
      if (target) {
        if (it) select(pv, [], [it.id]); else select(pv, [hs.id], []);
        tapStroke = hs; mode = 'move'; begin();
        if (it && it.type === 'text' && lastTap.id === it.id && performance.now() - lastTap.t < 380) { mode = 'edit'; engine.startEdit(pv, it.id); }
        lastTap = { id: it?.id || hs?.id, t: performance.now() };
        return;
      }
      engine.clearSelection(); mode = 'lasso'; lasso = [pt.x, pt.y];
    },
    move(pt) {
      if (mode === 'lasso') {
        lasso.push(pt.x, pt.y);
        const c = pv.ctx('live'); pv.clearLive();
        c.save(); c.strokeStyle = '#4f46e5'; c.fillStyle = 'rgba(79,70,229,.08)'; c.lineWidth = 1.5 / engine.zoom; c.setLineDash([6 / engine.zoom, 4 / engine.zoom]);
        c.beginPath(); c.moveTo(lasso[0], lasso[1]); for (let i = 2; i < lasso.length; i += 2) c.lineTo(lasso[i], lasso[i + 1]); c.closePath(); c.fill(); c.stroke(); c.restore();
        return;
      }
      if (!start || !orig) return;
      const dx = pt.x - start.x, dy = pt.y - start.y;
      if (mode === 'move') {
        if (!moved && Math.hypot(dx, dy) * engine.zoom < 4) return;
        apply((x, y) => [x + dx, y + dy], 1, 1, dx, dy);
      } else if (mode === 'resize') {
        const b = box0, west = handle.includes('w'), north = handle.includes('n');
        const ax = west ? b.x1 : b.x0, ay = north ? b.y1 : b.y0, ox = west ? b.x0 : b.x1, oy = north ? b.y0 : b.y1;
        const textOnly = !orig.strokes.size && [...orig.items.values()].every((i) => i.type === 'text');
        let kx, ky;
        if (textOnly) { kx = Math.max(0.1, (pt.x - ax) / (ox - ax)); ky = 1; }
        else {
          const vx = ox - ax, vy = oy - ay, k = ((pt.x - ax) * vx + (pt.y - ay) * vy) / (vx * vx + vy * vy);
          kx = ky = Math.max(0.05, k);
        }
        handle = handle || 'se';
        apply((x, y) => [ax + (x - ax) * kx, ay + (y - ay) * ky], kx, ky, 0, 0, ax, ay);
      }
    },
    up(pt) {
      if (mode === 'lasso') {
        pv.clearLive();
        const sIds = [], iIds = [];
        if (lasso.length >= 6) {
          for (const st of alive(pv.page.strokes)) {
            const p = st.pts; let inside = 0, n = 0;
            for (let i = 0; i < p.length; i += 3) { n++; if (polyContains(lasso, p[i], p[i + 1])) inside++; }
            if (n && inside / n >= 0.5) sIds.push(st.id);
          }
          for (const it of alive(pv.page.items)) { const r = itemRect(pv, it); if (polyContains(lasso, r.x + r.w / 2, r.y + r.h / 2)) iIds.push(it.id); }
        }
        if (sIds.length || iIds.length) select(pv, sIds, iIds);
        mode = null; return;
      }
      if (mode === 'edit') { mode = null; return; }
      if (orig) {
        pv.clearLive();
        if (moved) { pv.renderInk(); engine.commit(pv, before); api.renderUI(); }
        else if (tapStroke?.at && engine.audioMod && engine.players?.length) {
          engine.audioMod.seekForStroke(tapStroke, engine.players);
        }
      }
      void pt; mode = null; orig = null; handle = '';
    },
    cancel() {
      if (orig && moved) { pv.page.strokes = before.strokes.slice(); pv.page.items = before.items.slice(); pv.clearLive(); pv.renderInk(); pv.renderItems(); }
      mode = null; orig = null; handle = ''; pv?.clearLive();
    },

    // ---- selection actions ----
    selectAll(p = engine.currentPv()) { select(p, alive(p.page.strokes).map((s) => s.id), alive(p.page.items).map((i) => i.id)); },
    copy() {
      const s = S(); if (!s) return false;
      clipboard.data = {
        strokes: s.pv.page.strokes.filter((x) => !x.deleted && s.strokes.has(x.id)).map((x) => ({ ...x, pts: x.pts.slice() })),
        items: s.pv.page.items.filter((x) => !x.deleted && s.items.has(x.id)).map((x) => ({ ...x })),
      };
      clipboard.n = 0; return true;
    },
    delete() {
      const s = S(); if (!s) return;
      const p = s.pv, b = engine.snap(p);
      p.page.strokes = p.page.strokes.map((x) => (s.strokes.has(x.id) ? tomb(x) : x)); p.page.items = p.page.items.map((x) => (s.items.has(x.id) ? tomb(x) : x));
      engine.clearSelection(); engine.commit(p, b); p.renderInk(); p.renderItems();
    },
    cut() { if (this.copy()) this.delete(); },
    paste(target) {
      const c = clipboard.data; if (!c) return false;
      const p = target || engine.currentPv(); clipboard.n++;
      const off = 24 * clipboard.n, b = engine.snap(p);
      const ns = c.strokes.map((s) => cloneStroke(xformStroke(s, (x, y) => [x + off, y + off]), {}));
      const ni = c.items.map((i) => withData({ ...i, id: newId(), x: i.x + off, y: i.y + off }));
      p.page.strokes = [...p.page.strokes, ...ns]; p.page.items = [...p.page.items, ...ni];
      engine.commit(p, b); p.renderInk(); p.renderItems();
      if (engine.tool !== 'select') engine.setTool('select');
      select(p, ns.map((x) => x.id), ni.map((x) => x.id)); return true;
    },
    duplicate() { if (this.copy()) this.paste(S().pv); },
    recolor(color, final) {
      const s = S(); if (!s) return;
      if (!this._rb) this._rb = engine.snap(s.pv);
      const p = s.pv;
      p.page.strokes = p.page.strokes.map((x) => (s.strokes.has(x.id) && !x.deleted ? { ...x, color, u: Date.now() } : x));
      p.page.items = p.page.items.map((x) => (s.items.has(x.id) && x.type === 'text' ? withData({ ...x, color }) : x));
      p.renderInk(); p.renderItems();
      if (final) { engine.commit(p, this._rb); this._rb = null; engine.useColor(color); }
    },
    toTyped() {
      const s = S(); if (!s) return;
      const its = s.pv.page.items.filter((x) => !x.deleted && s.items.has(x.id) && x.type === 'text');
      if (!its.length) return;
      const html = its.map((x) => `<p>${x.html || ''}</p>`).join('');
      engine.emit('appendTyped', html);
      const p = s.pv, b = engine.snap(p);
      p.page.items = p.page.items.map((x) => (its.includes(x) ? tomb(x) : x));
      engine.clearSelection(); engine.commit(p, b); p.renderItems();
      toast('Moved to typed notes');
    },

    // ---- overlay UI ----
    renderUI() {
      const s = S(); if (!s) return;
      const p = s.pv; p.sel.replaceChildren();
      const b = selBox(); if (!b) return;
      const z = engine.zoom;
      const box = h('div', { class: 'ik-selbox', style: { left: b.x0 * z + 'px', top: b.y0 * z + 'px', width: (b.x1 - b.x0) * z + 'px', height: (b.y1 - b.y0) * z + 'px' } });
      for (const hd of ['nw', 'ne', 'sw', 'se']) box.append(h('div', { class: 'ik-handle ' + hd, 'data-handle': hd }));
      const hasText = [...s.items].some((id) => p.page.items.find((i) => i.id === id)?.type === 'text');
      const col = h('input', { type: 'color', class: 'ik-selcolor', title: 'Color', 'aria-label': 'Recolor' });
      col.addEventListener('input', () => api.recolor(col.value, false));
      col.addEventListener('change', () => api.recolor(col.value, true));
      const mk = (ic, label, fn) => { const x = h('button', { type: 'button', class: 'ik-btn sm', title: label, 'aria-label': label }); x.append(icon(ic, 18)); x.addEventListener('click', fn); return x; };
      const bar = h('div', { class: 'ik-selbar', 'data-ik-ui': '' },
        mk('copy', 'Duplicate', () => api.duplicate()), mk('doc', 'Copy', () => api.copy()), col,
        hasText ? mk('type', 'Convert to typed notes', () => api.toTyped()) : null,
        mk('trash', 'Delete', () => api.delete()));
      const barTop = b.y0 * z - 46;
      bar.style.left = Math.max(4, Math.min(p.w * z - 200, b.x0 * z)) + 'px';
      bar.style.top = (barTop < 2 ? b.y1 * z + 12 : barTop) + 'px';
      p.sel.append(box, bar);
    },
  };
  return api;
}
