// Eraser: whole-stroke mode and pixel (partial) mode. Model updates immediately, canvas redraw is rAF-batched.
import { strokeHit, eraseFromStroke, tomb } from '../stroke.js';

export function createEraserTool(engine) {
  let pv, before, last, raf = 0, dirty = false;
  const flush = () => { raf = 0; if (dirty) { dirty = false; pv.renderInk(); } };
  const sched = () => { dirty = true; if (!raf) raf = requestAnimationFrame(flush); };
  function hit(x, y) {
    const c = engine.settings.eraser, r = c.size, list = pv.page.strokes;
    if (c.mode === 'stroke') {
      let ch = false;
      const n = list.map((s) => { if (!s.locked && strokeHit(s, x, y, r * 0.5)) { ch = true; return tomb(s); } return s; });
      if (ch) { pv.page.strokes = n; sched(); }
    } else {
      let changed = false; const out = [];
      for (const s of list) { const res = s.locked ? null : eraseFromStroke(s, x, y, r * 0.8); if (res) { changed = true; out.push(tomb(s), ...res.map((p) => ({ ...p, u: Date.now() }))); } else out.push(s); }
      if (changed) { pv.page.strokes = out; sched(); }
    }
  }
  function line(a, b) {
    const r = engine.settings.eraser.size, d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / (r / 2)));
    for (let i = 1; i <= n; i++) hit(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
  }
  return {
    cursor: 'none',
    down(pt) { pv = pt.pv; before = engine.snap(pv); last = pt; hit(pt.x, pt.y); },
    move(pt) { if (!before) return; line(last, pt); last = pt; },
    up() { if (!before) return; cancelAnimationFrame(raf); flush(); const b = before; before = null; engine.commit(pv, b); },
    cancel() { if (!before) return; cancelAnimationFrame(raf); pv.page.strokes = before.strokes.slice(); before = null; pv.renderInk(); },
  };
}
