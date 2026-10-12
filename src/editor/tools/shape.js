// Explicit shape tool: drag to define line / rect / ellipse / triangle / arrow. Stored as strokes (shape flag).
import { newId } from '../../core/utils.js';
import { drawPath, shapePts } from '../stroke.js';

export function createShapeTool(engine) {
  let s = null, pv, x0, y0, live;
  return {
    cursor: 'crosshair',
    down(pt) {
      pv = pt.pv; const c = engine.settings.shape; x0 = pt.x; y0 = pt.y; live = pv.ctx('live');
      s = { id: newId(), tool: 'pen', color: c.color, size: c.size, shape: c.kind, pts: shapePts(c.kind, x0, y0, x0, y0) };
    },
    move(pt) {
      if (!s) return;
      let x = pt.x, y = pt.y;
      if (pt.e.shiftKey && s.shape !== 'line' && s.shape !== 'arrow') { const d = Math.max(Math.abs(x - x0), Math.abs(y - y0)); x = x0 + Math.sign(x - x0 || 1) * d; y = y0 + Math.sign(y - y0 || 1) * d; }
      s.pts = shapePts(s.shape, x0, y0, x, y); pv.clearLive(); drawPath(live, s);
    },
    up() {
      if (!s) return; const st = s; s = null; pv.clearLive();
      const p = st.pts; let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
      for (let i = 0; i < p.length; i += 3) { xa = Math.min(xa, p[i]); xb = Math.max(xb, p[i]); ya = Math.min(ya, p[i + 1]); yb = Math.max(yb, p[i + 1]); }
      if (Math.hypot(xb - xa, yb - ya) < 6) return;
      engine.addStroke(pv, st, true); engine.useColor(st.color);
    },
    cancel() { if (!s) return; s = null; pv.clearLive(); },
  };
}
