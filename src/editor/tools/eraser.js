// Eraser: whole-stroke mode and pixel (partial) mode.
// While dragging, the page shows a working copy; the model gets ONE clean change when the finger lifts
// (each touched stroke becomes a tombstone plus its surviving pieces), so there are no leftover fragments or duplicates.
import { strokeHit, eraseFromStroke, tomb, bboxOf } from '../stroke.js';

export function createEraserTool(engine) {
  let pv, before, last, raf = 0, dirty = false, work = null;
  const display = () => before.strokes.flatMap((s) => (work.has(s.id) ? work.get(s.id) : [s]));
  const flush = () => { raf = 0; if (dirty) { dirty = false; pv.page.strokes = display(); pv.renderInk(); } };
  const sched = () => { dirty = true; if (!raf) raf = requestAnimationFrame(flush); };
  function hit(x, y) {
    const c = engine.settings.eraser, r = c.size; let changed = false;
    for (const s of before.strokes) {
      if (s.deleted || s.locked) continue;
      const pieces = work.get(s.id) || [s];
      if (!pieces.length) continue;
      const b = bboxOf(s); if (x < b.x0 - r - 2 || x > b.x1 + r + 2 || y < b.y0 - r - 2 || y > b.y1 + r + 2) continue;
      if (c.mode === 'stroke') { if (pieces.some((q) => strokeHit(q, x, y, r * 0.8))) { work.set(s.id, []); changed = true; } continue; }
      let out = null;
      for (let i = 0; i < pieces.length; i++) {
        const res = eraseFromStroke(pieces[i], x, y, r * 0.9);
        if (res) { out = out || pieces.slice(0, i); out.push(...res); } else if (out) out.push(pieces[i]);
      }
      if (out) { work.set(s.id, out); changed = true; }
    }
    if (changed) sched();
  }
  function line(a, b) {
    const r = engine.settings.eraser.size, d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / (r / 2.5)));
    for (let i = 1; i <= n; i++) hit(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
  }
  return {
    cursor: 'none',
    down(pt) { pv = pt.pv; before = engine.snap(pv); work = new Map(); last = pt; hit(pt.x, pt.y); },
    move(pt) { if (!before) return; line(last, pt); last = pt; },
    up() {
      if (!before) return;
      cancelAnimationFrame(raf); raf = 0; const b = before, t = Date.now(); before = null;
      if (!work.size) return;
      pv.page.strokes = b.strokes.flatMap((s) => (work.has(s.id) ? [tomb(s), ...work.get(s.id).map((q) => ({ ...q, u: t }))] : [s]));
      pv.renderInk(); engine.commit(pv, b);
    },
    cancel() { if (!before) return; cancelAnimationFrame(raf); raf = 0; pv.page.strokes = before.strokes.slice(); before = null; pv.renderInk(); },
  };
}
