// Pen / highlighter / pencil: low-latency drawing, pressure, smoothing, hold-to-snap shapes, ruler.
// The fine pen is drawn as one smooth variable-width outline on the live layer (one repaint per frame, including the
// real pen tip and a short prediction so it never trails behind), then committed to the ink layer when the pen lifts.
import { newId } from '../../core/utils.js';
import { createInkFilter } from './smooth.js';
import { drawSegment, drawDot, drawPath, drawStroke, drawFine, recognizeShape, shapePts, widthFor } from '../stroke.js';

export function createPenTool(engine, kind) {
  let s = null, pv = null, ink = null, live = null, drawn = 0, snapped = false, latched = false;
  let flt = null, rawXY = [], rawP = [], ptype = 'mouse', pm = false, poly = false, curve = 1, timer = 0, anchor = null, predBox = null, lastP = 0.5, stab = 0;
  let tip = null, pred = [], box = null, raf = 0;
  const cfg = () => engine.settings[kind];

  // ---- live layer helpers ----
  const grow = (x, y) => { if (!box) box = { x0: x, y0: y, x1: x, y1: y }; else { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); } };
  const clearBox = () => { if (!box || !live) return; const pad = (s?.size || 4) * 1.4 + 3; live.clearRect(box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + pad * 2, box.y1 - box.y0 + pad * 2); box = null; };
  const frame = () => {
    raf = 0; if (!s) return;
    if (poly) {
      clearBox();
      const tail = [];
      if (tip) tail.push(tip.x, tip.y, lastP);
      for (const q of pred) tail.push(q.x, q.y, lastP);
      drawFine(live, s, tail);
      const P = s.pts; box = null;
      for (let i = 0; i < P.length; i += 3) grow(P[i], P[i + 1]);
      if (tip) grow(tip.x, tip.y); for (const q of pred) grow(q.x, q.y);
    } else if (pm) { pv.clearLive(); drawPath(live, s); }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const clearPred = () => {
    if (!predBox || !live) return;
    live.clearRect(predBox.x0, predBox.y0, predBox.x1 - predBox.x0, predBox.y1 - predBox.y0); predBox = null;
  };
  const finishLive = () => { clearTimeout(timer); cancelAnimationFrame(raf); raf = 0; clearPred(); if (pv) { pv.clearLive(); pv.cv.live.classList.remove('hl'); } box = null; };
  const redrawActive = () => {
    if (pm) { pv.clearLive(); drawPath(live, s); }
    else { pv.renderInk(); drawStroke(ink, s); }
  };
  function snapShape() {
    if (!s || snapped || s.pts.length < 18 || !cfg().snap || kind === 'pencil') return;
    const r = recognizeShape(s.pts); if (!r) return;
    clearPred(); clearBox();
    snapped = true; s.pts = r.pts; s.shape = r.kind;
    if (poly) { poly = false; pm = true; } // a recognised shape is previewed and committed like a highlighter path
    redrawActive();
    engine.buzz(8);
  }
  return {
    cursor: 'crosshair',
    down(pt) {
      pv = pt.pv; const c = cfg();
      latched = false;
      if (engine.ruler?.on) { engine.applyRuler(pt); latched = !!pt.snapped; }
      s = { id: newId(), tool: kind, color: c.color, size: c.size, pts: [pt.x, pt.y, pt.p] };
      pm = kind === 'highlighter' || (c.alpha ?? 1) < 1; curve = c.curve || engine.prefs.curve || 1;
      poly = kind === 'pen' && !pm && (!c.brush || c.brush === 'fine');
      if ((c.alpha ?? 1) < 1) s.alpha = c.alpha;
      if (kind === 'highlighter' && c.chisel) s.chisel = true;
      if (c.taper != null && kind === 'pen') s.taper = c.taper;
      if (kind === 'pen' && c.brush && c.brush !== 'fine') s.brush = c.brush;
      stab = c.stab ?? 0; ptype = pt.type === 'pen' ? 'pen' : pt.type === 'touch' ? 'touch' : 'mouse';
      rawXY = [pt.cx, pt.cy, pt.t]; rawP = [pt.p]; pt.p = engine.pressure(pt.p, ptype); s.pts[2] = pt.p;
      flt = createInkFilter(ptype, engine.smoothingFor(ptype)); flt.reset(pt.x, pt.y, pt.t);
      lastP = pt.p; snapped = false; drawn = 0; predBox = null; tip = null; pred = []; box = null;
      ink = pv.ctx('ink'); live = pv.ctx('live');
      anchor = pt;
      if (poly) schedule();
      else if (pm) { if (kind === 'highlighter') pv.cv.live.classList.add('hl'); drawDot(live, s); }
      else if (kind === 'pen') drawDot(ink, s);
    },
    move(pt) {
      if (!s) return;
      if (snapped) {
        if (s.shape === 'line') {
          const x = s.pts[0], y = s.pts[1]; s.pts = shapePts('line', x, y, pt.x, pt.y); redrawActive();
        }
        return;
      }
      if (latched || engine.ruler?.on) { pt.latched = latched; engine.applyRuler(pt); }
      rawXY.push(pt.cx, pt.cy, pt.t); rawP.push(pt.p); pt.p = engine.pressure(pt.p, ptype);
      const rx = pt.x, ry = pt.y;
      lastP = lastP * 0.6 + pt.p * 0.4; // pressure eases, so the width never jumps
      if (poly) tip = { x: rx, y: ry };  // the pen tip is always drawn where the pen really is
      if (!latched && !engine.ruler?.on && flt) { const q = flt.step(pt.x, pt.y, pt.t, engine.zoom); pt.x = q.x; pt.y = q.y; }
      const n = s.pts.length;
      if (stab > 0) { pt.x = s.pts[n - 3] + (pt.x - s.pts[n - 3]) * (1 - stab); pt.y = s.pts[n - 2] + (pt.y - s.pts[n - 2]) * (1 - stab); }
      const minD = (poly ? 0.5 : 1) / engine.zoom;
      if (Math.hypot(pt.x - s.pts[n - 3], pt.y - s.pts[n - 2]) < minD) { if (poly) schedule(); return; }
      if (curve !== 1 && pt.type !== 'mouse') lastP = Math.min(1, Math.pow(Math.max(0, lastP), curve));
      s.pts.push(pt.x, pt.y, lastP);
      const m = s.pts.length / 3;
      if (poly) schedule();
      else if (pm) { clearPred(); schedule(); }
      else { while (drawn <= m - 2) drawSegment(ink, s, drawn++); }
      if (Math.hypot(pt.cx - anchor.cx, pt.cy - anchor.cy) > 5) {
        anchor = pt; clearTimeout(timer);
        if (cfg().snap && kind !== 'pencil' && !latched) timer = setTimeout(snapShape, engine.prefs.snapDelay || 520);
      }
    },
    predict(ps) {
      if (!s || snapped || pm) return;
      if (poly) { pred = ps.slice(0, 2).map((q) => ({ x: q.x, y: q.y })); schedule(); return; }
      clearPred();
      if (!ps.length) return;
      const n = s.pts.length; let x = s.pts[n - 3], y = s.pts[n - 2];
      let x0 = x, y0 = y, x1 = x, y1 = y;
      live.save();
      live.strokeStyle = s.color; live.lineCap = 'round'; live.lineJoin = 'round';
      live.lineWidth = widthFor(kind, s.size, lastP); live.globalAlpha = kind === 'pencil' ? 0.5 : 1;
      live.beginPath(); live.moveTo(x, y);
      for (const p of ps.slice(0, 3)) { live.lineTo(p.x, p.y); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      live.stroke(); live.restore();
      const pad = s.size * 1.6 + 2; predBox = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    },
    up(pt) {
      if (!s) return;
      clearTimeout(timer); clearPred(); cancelAnimationFrame(raf); raf = 0;
      const st = s; s = null;
      if (!snapped && st.pts.length > 3 && pt) { // land the stroke exactly where the pen lifted
        const n = st.pts.length, ex = pt.x, ey = pt.y, d = Math.hypot(ex - st.pts[n - 3], ey - st.pts[n - 2]);
        if (d > 0.6 / engine.zoom && d < 40 / engine.zoom) st.pts.push(ex, ey, st.pts[n - 1]);
      }
      st.pts = st.pts.map((v) => Math.round(v * 100) / 100);
      const wasPoly = poly && !snapped;
      if (wasPoly) { drawStroke(ink, st); pv.clearLive(); box = null; }
      else if (!snapped && !pm) {
        const m = st.pts.length / 3;
        if (m === 1 && kind === 'pencil') drawDot(ink, st);
        while (drawn < m && m > 1) drawSegment(ink, st, drawn++);
      }
      const hl = pm;
      engine.addStroke(pv, st, hl);
      if (hl) finishLive();
      engine.useColor(st.color);
      engine.learnStroke(ptype, rawXY, rawP);
    },
    cancel() { if (!s) return; s = null; finishLive(); pv.renderInk(); },
  };
}
