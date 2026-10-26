// Free canvas navigation aids: a live minimap (click or drag to move the camera) and a "back to content" pill.
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { pref } from './ui.js';
import { contentBounds } from './canvasmode.js';

const W = 184, H = 124, PAD = 0.1;

export function createMinimap(engine) {
  let pv = engine.camPv();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = h('canvas', { class: 'ik-mm-cv', width: Math.round(W * dpr), height: Math.round(H * dpr) });
  const ctx = cv.getContext('2d');
  const cache = document.createElement('canvas'); cache.width = cv.width; cache.height = cv.height;
  const toggle = h('button', { type: 'button', class: 'ik-mm-t', title: 'Minimap', 'aria-label': 'Toggle minimap' });
  toggle.append(icon('layout', 16));
  const panel = h('div', { class: 'ik-mm', 'data-ik-ui': '' }, cv);
  const back = h('button', { type: 'button', class: 'ik-backhome', 'data-ik-ui': '', hidden: true }, 'Scroll back to content');
  const root = h('div', { class: 'ik-mmwrap' }, back, h('div', { class: 'ik-mmbox', 'data-ik-ui': '' }, panel, toggle));
  let collapsed = !!pref.get('minimap', false), version = 0, key = '', raf = 0, frozen = null;
  root.classList.toggle('off', collapsed);

  const view = () => { const c = pv.cam; return { x0: c.x, y0: c.y, x1: c.x + pv.vw / c.z, y1: c.y + pv.vh / c.z }; };
  const extent = (b, v) => {
    const e = b ? { x0: Math.min(b.x0, v.x0), y0: Math.min(b.y0, v.y0), x1: Math.max(b.x1, v.x1), y1: Math.max(b.y1, v.y1) } : { ...v };
    const px = (e.x1 - e.x0) * PAD, py = (e.y1 - e.y0) * PAD;
    return { x0: e.x0 - px, y0: e.y0 - py, x1: e.x1 + px, y1: e.y1 + py };
  };
  const fit = (e) => { const k = Math.min(W / (e.x1 - e.x0), H / (e.y1 - e.y0)); return { k, ox: (W - (e.x1 - e.x0) * k) / 2 - e.x0 * k, oy: (H - (e.y1 - e.y0) * k) / 2 - e.y0 * k }; };

  function paintContent(e, t) {
    const c = cache.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.lineCap = c.lineJoin = 'round';
    for (const s of pv.page.strokes) {
      if (s.deleted || !s.pts?.length) continue;
      const n = s.pts.length / 3, step = Math.max(1, Math.ceil(n / 20));
      c.beginPath(); c.moveTo(s.pts[0] * t.k + t.ox, s.pts[1] * t.k + t.oy);
      for (let i = step; i < n; i += step) c.lineTo(s.pts[i * 3] * t.k + t.ox, s.pts[i * 3 + 1] * t.k + t.oy);
      if (n > 1) c.lineTo(s.pts[(n - 1) * 3] * t.k + t.ox, s.pts[(n - 1) * 3 + 1] * t.k + t.oy);
      c.strokeStyle = s.color || '#475569'; c.globalAlpha = s.tool === 'highlighter' ? 0.4 : 0.9;
      c.lineWidth = Math.max(1, Math.min(3, (s.size || 2) * t.k * (s.tool === 'highlighter' ? 1 : 1.4)));
      c.stroke();
    }
    c.globalAlpha = 1; c.fillStyle = 'rgba(100,116,139,.35)';
    for (const it of pv.page.items) if (!it.deleted) c.fillRect(it.x * t.k + t.ox, it.y * t.k + t.oy, Math.max(2, it.w * t.k), Math.max(2, (it.h || 30) * t.k));
  }

  function paint() {
    raf = 0; pv = engine.camPv() || pv; if (!pv.vw) return;
    const b = contentBounds(pv.page), v = view();
    back.hidden = !b || (b.x1 > v.x0 && b.x0 < v.x1 && b.y1 > v.y0 && b.y0 < v.y1);
    if (collapsed) return;
    const e = frozen || extent(b, v), t = fit(e), id = [version, Math.round(e.x0), Math.round(e.y0), Math.round(e.x1), Math.round(e.y1)].join('|');
    if (id !== key) { key = id; paintContent(e, t); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cache, 0, 0, W, H);
    const rx = v.x0 * t.k + t.ox, ry = v.y0 * t.k + t.oy, rw = (v.x1 - v.x0) * t.k, rh = (v.y1 - v.y0) * t.k;
    ctx.fillStyle = 'rgba(79,70,229,.10)'; ctx.strokeStyle = 'rgba(79,70,229,.95)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, 3); ctx.fill(); ctx.stroke();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  const at = (ev) => {
    pv = engine.camPv() || pv;
    const r = cv.getBoundingClientRect(), t = fit(frozen), px = ev.clientX - r.left, py = ev.clientY - r.top;
    const wx = (px - t.ox) / t.k, wy = (py - t.oy) / t.k, c = pv.cam;
    c.x = wx - pv.vw / 2 / c.z; c.y = wy - pv.vh / 2 / c.z; pv.redraw(); engine._camMoved(pv);
  };
  cv.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); cv.setPointerCapture(ev.pointerId);
    frozen = extent(contentBounds(pv.page), view()); at(ev);
    const move = (e) => at(e), up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); frozen = null; schedule(); };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  });
  toggle.addEventListener('click', () => { collapsed = !collapsed; pref.set('minimap', collapsed); root.classList.toggle('off', collapsed); schedule(); });
  back.addEventListener('click', () => engine.fitContent());
  engine.on('cam', schedule);
  engine.on('change', () => { version++; schedule(); });
  engine.on('history', () => { version++; schedule(); });
  engine.on('pages', () => { version++; schedule(); });
  setTimeout(schedule, 50);
  return root;
}
