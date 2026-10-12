// Explicit shape tool: drag to define line / rect / ellipse / triangle / arrow. Stored as strokes (shape flag).
import { newId } from '../../core/utils.js';
import { drawPath, shapePts, alive } from '../stroke.js';
import { targetAt, connect } from '../connectors.js';

export function createShapeTool(engine) {
  let s = null, pv, x0, y0, live, bindA = null;
  return {
    cursor: 'crosshair',
    down(pt) {
      pv = pt.pv; const c = engine.settings.shape; x0 = engine.snapV(pt.x); y0 = engine.snapV(pt.y); live = pv.ctx('live');
      bindA = /^(line|arrow|darrow)$/.test(c.kind) ? targetAt(pv.page.strokes, pt.x, pt.y) : null;
      s = { id: newId(), tool: 'pen', color: c.color, size: c.size, shape: c.kind, pts: shapePts(c.kind, x0, y0, x0, y0) };
      if (c.sketch && engine.enabled('excalidraw')) { s.sketch = true; if (c.fillStyle && c.fillStyle !== 'solid') s.fillStyle = c.fillStyle; else if (c.fill) s.fillStyle = 'solid'; }
      if (c.fill) s.fill = c.fill; if (c.dash) s.dash = true; if ((c.alpha ?? 1) < 1) s.alpha = c.alpha;
    },
    move(pt) {
      if (!s) return;
      let x = engine.snapV(pt.x), y = engine.snapV(pt.y);
      if (pt.e.shiftKey && s.shape !== 'line' && s.shape !== 'arrow') { const d = Math.max(Math.abs(x - x0), Math.abs(y - y0)); x = x0 + Math.sign(x - x0 || 1) * d; y = y0 + Math.sign(y - y0 || 1) * d; }
      s.pts = shapePts(s.shape, x0, y0, x, y); pv.clearLive(); drawPath(live, s);
    },
    up(pt) {
      if (!s) return; const st = s; s = null; pv.clearLive();
      if (/^(line|arrow|darrow)$/.test(st.shape) && engine.enabled('excalidraw')) {
        const B = targetAt(pv.page.strokes, pt.x, pt.y);
        if (bindA || B) { const p = st.pts, r = connect(st.shape, bindA, B !== bindA ? B : null, [p[0], p[1]], [p[3], p[4]]); st.pts = r.pts; st.bind = { a: bindA?.id || null, b: (B !== bindA && B?.id) || null }; }
      }
      const p = st.pts; let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
      for (let i = 0; i < p.length; i += 3) { xa = Math.min(xa, p[i]); xb = Math.max(xb, p[i]); ya = Math.min(ya, p[i + 1]); yb = Math.max(yb, p[i + 1]); }
      if (Math.hypot(xb - xa, yb - ya) < 6) return;
      engine.addStroke(pv, st, true); engine.useColor(st.color);
    },
    cancel() { if (!s) return; s = null; pv.clearLive(); },
  };
}
