// Lasso / select tool: select strokes + items, move, resize, copy/paste, delete, recolor, convert text.
import { h, newId } from '../../core/utils.js';
import { bboxOf, strokeHit, polyContains, xformStroke, cloneStroke, drawStroke, tomb, alive } from '../stroke.js';
import { itemRect, withData } from '../items.js';
import { icon } from '../icons.js';
import { toast } from '../../core/store.js';
import { fixBindings, isConnector } from '../connectors.js';
import { CLOSED } from '../shapes.js';
import { pref } from '../ui.js';

export const clipboard = { data: null, n: 0 };

export function createSelectTool(engine) {
  let extra = new Set(), mode = null, pv = null, start = null, before = null, orig = null, box0 = null, handle = '', moved = false, lasso = [], tapStroke = null, lastTap = { id: null, t: 0 };

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
    const gs = new Set(strokes), gi = new Set(items);
    const groups = new Set([...p.page.strokes, ...p.page.items].filter((x) => !x.deleted && x.groupId && (gs.has(x.id) || gi.has(x.id))).map((x) => x.groupId));
    if (groups.size) { for (const x of p.page.strokes) if (!x.deleted && groups.has(x.groupId)) gs.add(x.id); for (const x of p.page.items) if (!x.deleted && groups.has(x.groupId)) gi.add(x.id); }
    engine.selection = { pv: p, strokes: gs, items: gi };
    api.renderUI(); engine.emit('selection', engine.selection);
  }
  function begin() {
    before = engine.snap(pv);
    const s = S();
    orig = { strokes: new Map(), items: new Map() };
    for (const st of before.strokes) if (s.strokes.has(st.id) && !st.locked && !st.deleted) orig.strokes.set(st.id, st);
    for (const it of before.items) if (s.items.has(it.id) && !it.locked && !it.deleted) orig.items.set(it.id, it);
    extra = new Set(before.strokes.filter((st) => isConnector(st) && !s.strokes.has(st.id) && (s.strokes.has(st.bind.a) || s.strokes.has(st.bind.b))).map((st) => st.id));
    box0 = selBox(); moved = false;
  }
  let raf = 0;
  function apply(f, sk, itemFn) {
    const page = pv.page, ns = new Map();
    page.strokes = before.strokes.map((st) => {
      const o = orig.strokes.get(st.id); if (!o) return st;
      let n = xformStroke(o, f, sk);
      if (n.bind) { const sl = S().strokes; if ((n.bind.a && !sl.has(n.bind.a)) || (n.bind.b && !sl.has(n.bind.b))) n = { ...n, bind: undefined }; }
      ns.set(st.id, n); return n;
    });
    { const fx = fixBindings(page.strokes); if (fx.updated.length) { page.strokes = fx.list; for (const u of fx.updated) ns.set(u.id, u); } }
    page.items = before.items.map((it) => { const o = orig.items.get(it.id); return o ? withData(itemFn(o)) : it; });
    if (!moved) { moved = true; pv.renderInk(new Set([...orig.strokes.keys(), ...extra])); }
    pv.ctx('live'); pv.clearLive(); const live = pv.ctx('live');
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
      if (hd && S()) { mode = hd === 'rot' ? 'rotate' : 'resize'; handle = hd; begin(); return; }
      const sel = S(), z = engine.zoom, r = 10 / z;
      const it = engine.itemAt(pv, pt.x, pt.y);
      let hs = null;
      for (let i = pv.page.strokes.length - 1; i >= 0; i--) if (strokeHit(pv.page.strokes[i], pt.x, pt.y, r)) { hs = pv.page.strokes[i]; break; }
      if (sel && sel.pv === pv && inBox(selBox(), pt.x, pt.y, 4)) { if (pt.e.ctrlKey || pt.e.altKey) { api.duplicate(); } mode = 'move'; tapStroke = hs; begin(); return; }
      if (!it && hs && hs.shape && CLOSED.has(hs.shape) && lastTap.id === hs.id && performance.now() - lastTap.t < 380 && engine.enabled('excalidraw')) {
        const b = bboxOf(hs), fs = engine.settings.text.fontSize; mode = 'edit'; lastTap = { id: null, t: 0 };
        engine.insertTextBox(pv, b.x0 + (b.x1 - b.x0) * 0.1, (b.y0 + b.y1) / 2 - fs * 0.8, '', '', { w: (b.x1 - b.x0) * 0.8, align: 'center' }); return;
      }
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
        const mx = engine.snapV(box0.x0 + dx) - box0.x0, my = engine.snapV(box0.y0 + dy) - box0.y0;
        apply((x, y) => [x + mx, y + my], 1, (o) => ({ ...o, x: o.x + mx, y: o.y + my }));
      } else if (mode === 'rotate') {
        const b = box0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        let d = Math.atan2(pt.y - cy, pt.x - cx) - Math.atan2(start.y - cy, start.x - cx);
        const snap = Math.round(d / (Math.PI / 12)) * (Math.PI / 12); if (Math.abs(d - snap) < 0.06) d = snap;
        const co = Math.cos(d), si = Math.sin(d), rot = (x, y) => [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co];
        apply(rot, 1, (o) => { const [nx, ny] = rot(o.x + o.w / 2, o.y + o.h / 2); return { ...o, x: nx - o.w / 2, y: ny - o.h / 2, rotation: (o.rotation || 0) + (d * 180) / Math.PI }; });
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
        apply((x, y) => [ax + (x - ax) * kx, ay + (y - ay) * ky], Math.sqrt(kx * ky), (o) => ({ ...o, x: ax + (o.x - ax) * kx, y: ay + (o.y - ay) * ky, w: o.w * kx, h: o.h * ky }));
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
      p.page.strokes = p.page.strokes.map((x) => (s.strokes.has(x.id) && !x.locked ? tomb(x) : x)); p.page.items = p.page.items.map((x) => (s.items.has(x.id) && !x.locked ? tomb(x) : x));
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
    /** generic mutation of the selected objects: fs(stroke, box), fi(item, box) -> replacement */
    mutate(fs, fi, keepSel = true) {
      const s = S(); if (!s) return;
      const p = s.pv, b = engine.snap(p), box = selBox(), t = Date.now();
      p.page.strokes = p.page.strokes.map((x) => (!x.deleted && s.strokes.has(x.id) ? { ...fs(x, box), u: t } : x));
      p.page.items = p.page.items.map((x) => (!x.deleted && s.items.has(x.id) ? withData(fi(x, box)) : x));
      engine.fixConnectors(p);
      engine.commit(p, b); p.renderInk(); p.renderItems(); if (keepSel) api.renderUI();
    },
    group(on = true) { const g = on ? newId() : undefined; this.mutate((x) => ({ ...x, groupId: g }), (x) => ({ ...x, groupId: g })); },
    flip(axis) {
      const f = axis === 'h' ? (b) => (x, y) => [b.x0 + b.x1 - x, y] : (b) => (x, y) => [x, b.y0 + b.y1 - y];
      this.mutate((x, b) => xformStroke(x, f(b)), (x, b) => (axis === 'h' ? { ...x, x: b.x0 + b.x1 - x.x - x.w } : { ...x, y: b.y0 + b.y1 - x.y - x.h }));
    },
    align(dir) {
      const s = S(); if (!s) return; const box = selBox(), pvv = s.pv;
      const off = (r) => ({ left: [box.x0 - r.x0, 0], right: [box.x1 - r.x1, 0], hc: [(box.x0 + box.x1) / 2 - (r.x0 + r.x1) / 2, 0], top: [0, box.y0 - r.y0], bottom: [0, box.y1 - r.y1], vc: [0, (box.y0 + box.y1) / 2 - (r.y0 + r.y1) / 2] }[dir]);
      this.mutate((x) => { const [dx, dy] = off(bboxOf(x)); return xformStroke(x, (a, c) => [a + dx, c + dy]); },
        (x) => { const [dx, dy] = off({ x0: x.x, x1: x.x + x.w, y0: x.y, y1: x.y + x.h }); return { ...x, x: x.x + dx, y: x.y + dy }; });
    },
    order(front) {
      const s = S(); if (!s) return;
      const p = s.pv, b = engine.snap(p), ns = [], ni = [];
      const strokes = p.page.strokes.map((x) => { if (x.deleted || !s.strokes.has(x.id)) return x; const c = { ...x, id: newId(), u: Date.now() }; ns.push(c); return tomb(x); });
      const items = p.page.items.map((x) => { if (x.deleted || !s.items.has(x.id)) return x; const c = { ...x, id: newId() }; ni.push(withData(c)); return tomb(x); });
      p.page.strokes = front ? [...strokes, ...ns] : [...ns, ...strokes]; p.page.items = front ? [...items, ...ni] : [...ni, ...items];
      engine.commit(p, b); p.renderInk(); p.renderItems(); select(p, ns.map((x) => x.id), ni.map((x) => x.id));
    },
    moreMenu(anchor) {
      const s = S(); if (!s) return;
      const grouped = [...s.pv.page.strokes, ...s.pv.page.items].some((x) => !x.deleted && x.groupId && (s.strokes.has(x.id) || s.items.has(x.id)));
      engine.emit('menu', { anchor, items: [
        { label: grouped ? 'Ungroup' : 'Group', icon: 'layout', run: () => api.group(!grouped) },
        { title: 'Align' },
        ...[['left', 'Left'], ['hc', 'Center'], ['right', 'Right'], ['top', 'Top'], ['vc', 'Middle'], ['bottom', 'Bottom']].map(([d, n]) => ({ label: n, icon: 'minus', run: () => api.align(d) })),
        { title: 'Ink' },
        ...[['smooth', 'Smooth'], ['simplify', 'Simplify'], ['straighten', 'Straighten to line'], ['toShape', 'Convert to shape'], ['thicker', 'Thicker'], ['thinner', 'Thinner']].map(([k, n]) => ({ label: n, icon: 'pen', run: () => import('../transform.js').then((m) => m.inkOp(engine, k)) })),
        { label: 'Inspector (x, y, size, angle)...', icon: 'sliders', run: () => setTimeout(() => import('../transform.js').then((m) => m.inspector(anchor, engine)), 0) },
        { label: 'Lock / unlock', icon: 'pin', run: () => api.lock([...s.pv.page.strokes, ...s.pv.page.items].some((x) => !x.deleted && x.locked && (s.strokes.has(x.id) || s.items.has(x.id))) ? false : true) },
        { label: 'Zoom to selection', icon: 'fit', run: () => engine.zoomToBox(s.pv, selBox()) },
        { label: 'Frame with title...', icon: 'layout', run: () => engine.insertFrame(prompt('Frame title', 'Frame') || 'Frame', selBox()) },
        { label: 'Save to library...', icon: 'star', run: () => api.saveToLibrary(prompt('Name for this element', 'My element')) },
        ...(engine.enabled('ocr') ? [{ label: 'Recognize text', icon: 'type', run: () => engine.emit('ocr', { selection: true }) }] : []),
        { title: 'Arrange' },
        { label: 'Flip horizontal', icon: 'columns', run: () => api.flip('h') }, { label: 'Flip vertical', icon: 'layout', run: () => api.flip('v') },
        { label: 'Bring to front', icon: 'up', run: () => api.order(true) }, { label: 'Send to back', icon: 'down', run: () => api.order(false) },
      ] });
    },
    box() { return selBox(); },
    selectIds(p, s, i) { select(p, s, i); },
    lock(on = true) { this.mutate((x) => ({ ...x, locked: on || undefined }), (x) => ({ ...x, locked: on || undefined })); },
    saveToLibrary(name) {
      const s = S(); if (!s) return; const b = selBox();
      const lib = pref.get('library', []);
      lib.push({ name: name || 'My element', strokes: s.pv.page.strokes.filter((x) => !x.deleted && s.strokes.has(x.id)).map((x) => ({ ...x, bind: undefined, by: undefined, at: undefined, pts: x.pts.map((v, i) => (i % 3 === 0 ? v - b.x0 : i % 3 === 1 ? v - b.y0 : v)) })),
        items: s.pv.page.items.filter((x) => !x.deleted && s.items.has(x.id)).map((x) => ({ ...x, x: x.x - b.x0, y: x.y - b.y0 })), w: b.x1 - b.x0, h: b.y1 - b.y0 });
      pref.set('library', lib.slice(-24)); toast('Saved to library');
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
      for (const hd of ['nw', 'ne', 'sw', 'se', 'rot']) box.append(h('div', { class: 'ik-handle ' + hd, 'data-handle': hd }));
      const hasText = [...s.items].some((id) => p.page.items.find((i) => i.id === id)?.type === 'text');
      const col = h('input', { type: 'color', class: 'ik-selcolor', title: 'Color', 'aria-label': 'Recolor' });
      col.addEventListener('input', () => api.recolor(col.value, false));
      col.addEventListener('change', () => api.recolor(col.value, true));
      const mk = (ic, label, fn) => { const x = h('button', { type: 'button', class: 'ik-btn sm', title: label, 'aria-label': label }); x.append(icon(ic, 18)); x.addEventListener('click', fn); return x; };
      const bar = h('div', { class: 'ik-selbar', 'data-ik-ui': '' },
        mk('copy', 'Duplicate', () => api.duplicate()), mk('doc', 'Copy', () => api.copy()), col,
        hasText ? mk('type', 'Convert to typed notes', () => api.toTyped()) : null,
        mk('more', 'More: group, align, flip, order', (e) => api.moreMenu(e.currentTarget)),
        mk('trash', 'Delete', () => api.delete()));
      const barTop = b.y0 * z - 46;
      bar.style.left = Math.max(4, Math.min(p.w * z - 200, b.x0 * z)) + 'px';
      bar.style.top = (barTop < 2 ? b.y1 * z + 12 : barTop) + 'px';
      p.sel.append(box, bar);
    },
  };
  return api;
}
