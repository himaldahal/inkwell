// Pen / highlighter / pencil: low-latency incremental drawing, pressure, smoothing, hold-to-snap shapes, ruler.
import { newId } from '../../core/utils.js';
import { drawSegment, drawDot, drawPath, drawStroke, recognizeShape, shapePts, widthFor } from '../stroke.js';

export function createPenTool(engine, kind) {
  let s = null, pv = null, ink = null, live = null, drawn = 0, snapped = false, latched = false;
  let timer = 0, anchor = null, predBox = null, lastP = 0.5, stab = 0;
  const cfg = () => engine.settings[kind];
  const clearPred = () => {
    if (!predBox || !live) return;
    live.clearRect(predBox.x0, predBox.y0, predBox.x1 - predBox.x0, predBox.y1 - predBox.y0); predBox = null;
  };
  const finishLive = () => { clearTimeout(timer); clearPred(); if (pv) { pv.clearLive(); pv.cv.live.classList.remove('hl'); } };
  const redrawActive = () => {
    if (kind === 'highlighter') { pv.clearLive(); drawPath(live, s); }
    else { pv.renderInk(); drawStroke(ink, s); }
  };
  function snapShape() {
    if (!s || snapped || s.pts.length < 18 || !cfg().snap || kind === 'pencil') return;
    const r = recognizeShape(s.pts); if (!r) return;
    clearPred();
    snapped = true; s.pts = r.pts; s.shape = r.kind; redrawActive();
    navigator.vibrate?.(8);
  }
  return {
    cursor: 'crosshair',
    down(pt) {
      pv = pt.pv; const c = cfg();
      latched = false;
      if (engine.ruler?.on) { engine.applyRuler(pt); latched = !!pt.snapped; }
      s = { id: newId(), tool: kind, color: c.color, size: c.size, pts: [pt.x, pt.y, pt.p] };
      if (kind === 'pen' && c.brush && c.brush !== 'fine') s.brush = c.brush;
      stab = c.stab || 0;
      lastP = pt.p; snapped = false; drawn = 0; predBox = null;
      ink = pv.ctx('ink'); live = pv.ctx('live');
      anchor = pt;
      if (kind === 'highlighter') { pv.cv.live.classList.add('hl'); drawDot(live, s); }
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
      const n = s.pts.length;
      if (stab > 0) { pt.x = s.pts[n - 3] + (pt.x - s.pts[n - 3]) * (1 - stab); pt.y = s.pts[n - 2] + (pt.y - s.pts[n - 2]) * (1 - stab); }
      const minD = 1 / engine.zoom;
      if (Math.hypot(pt.x - s.pts[n - 3], pt.y - s.pts[n - 2]) < minD) return;
      lastP = lastP * 0.55 + pt.p * 0.45;
      s.pts.push(pt.x, pt.y, lastP);
      const m = s.pts.length / 3;
      if (kind === 'highlighter') { clearPred(); pv.clearLive(); drawPath(live, s); }
      else { while (drawn <= m - 2) drawSegment(ink, s, drawn++); }
      if (Math.hypot(pt.cx - anchor.cx, pt.cy - anchor.cy) > 5) {
        anchor = pt; clearTimeout(timer);
        if (cfg().snap && kind !== 'pencil' && !latched) timer = setTimeout(snapShape, 520);
      }
    },
    predict(ps) {
      if (!s || snapped || kind === 'highlighter') return;
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
    up() {
      if (!s) return;
      clearTimeout(timer); clearPred();
      const st = s; s = null;
      if (!snapped && kind !== 'highlighter') {
        const m = st.pts.length / 3;
        if (m === 1 && kind === 'pencil') drawDot(ink, st);
        while (drawn < m && m > 1) drawSegment(ink, st, drawn++);
      }
      st.pts = st.pts.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 100) / 100));
      const hl = kind === 'highlighter';
      engine.addStroke(pv, st, hl);
      if (hl) finishLive();
      engine.useColor(st.color);
    },
    cancel() { if (!s) return; s = null; finishLive(); pv.renderInk(); },
  };
}
