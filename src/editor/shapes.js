// Shape library. Shapes are stored as polyline strokes (shape flag); pressure -1 marks "pen up" (start a new subpath).
export const SHAPES = [
  ['line', 'Line'], ['arrow', 'Arrow'], ['darrow', 'Double arrow'], ['rect', 'Rectangle'], ['rrect', 'Rounded'], ['ellipse', 'Ellipse'],
  ['triangle', 'Triangle'], ['diamond', 'Diamond'], ['star', 'Star'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['arc', 'Arc'],
  ['bubble', 'Speech bubble'], ['check', 'Check'], ['cross', 'Cross'], ['brace', 'Brace'], ['axis', 'Axis'], ['graph', 'Graph'], ['table', 'Table'],
];
export const CLOSED = new Set(['rect', 'rrect', 'ellipse', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'bubble']);

export function buildShape(kind, ax, ay, bx, by) {
  const P = [];
  const l = (x, y) => P.push(x, y, 0.5), m = (x, y) => P.push(x, y, -1);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by), w = x1 - x0, h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const quad = (px, py, qx, qy, rx, ry) => { for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; l(u * u * px + 2 * u * t * qx + t * t * rx, u * u * py + 2 * u * t * qy + t * t * ry); } };
  const head = (x, y, a, len) => { m(x - len * Math.cos(a - 0.5), y - len * Math.sin(a - 0.5)); l(x, y); l(x - len * Math.cos(a + 0.5), y - len * Math.sin(a + 0.5)); };
  const poly = (n, start) => { for (let i = 0; i <= n; i++) { const a = start + (i / n) * 6.28319; i ? l(cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a)) : l(cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a)); } };
  switch (kind) {
    case 'darrow': { const a = Math.atan2(by - ay, bx - ax), L = Math.hypot(bx - ax, by - ay), hl = Math.min(44, Math.max(14, L * 0.2)); l(ax, ay); l(bx, by); head(bx, by, a, hl); head(ax, ay, a + Math.PI, hl); break; }
    case 'rrect': { const r = Math.min(w, h) * 0.2; l(x0 + r, y0); l(x1 - r, y0); quad(x1 - r, y0, x1, y0, x1, y0 + r); l(x1, y1 - r); quad(x1, y1 - r, x1, y1, x1 - r, y1); l(x0 + r, y1); quad(x0 + r, y1, x0, y1, x0, y1 - r); l(x0, y0 + r); quad(x0, y0 + r, x0, y0, x0 + r, y0); break; }
    case 'diamond': l(cx, y0); l(x1, cy); l(cx, y1); l(x0, cy); l(cx, y0); break;
    case 'star': for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1; l(cx + (w / 2) * r * Math.cos(a), cy + (h / 2) * r * Math.sin(a)); } break;
    case 'pentagon': poly(5, -Math.PI / 2); break;
    case 'hexagon': poly(6, 0); break;
    case 'arc': for (let i = 0; i <= 40; i++) { const a = Math.PI + (i / 40) * Math.PI; l(cx + (w / 2) * Math.cos(a), y1 + h * Math.sin(a)); } break;
    case 'bubble': { const yb = y0 + h * 0.78; l(x0, y0); l(x1, y0); l(x1, yb); l(x0 + w * 0.55, yb); l(x0 + w * 0.25, y1); l(x0 + w * 0.3, yb); l(x0, yb); l(x0, y0); break; }
    case 'check': l(x0, y0 + h * 0.55); l(x0 + w * 0.38, y1); l(x1, y0); break;
    case 'cross': l(x0, y0); l(x1, y1); m(x1, y0); l(x0, y1); break;
    case 'brace': { const ym = cy; l(x1, y0); quad(x1, y0, cx, y0, cx, y0 + h * 0.2); l(cx, ym - h * 0.12); quad(cx, ym - h * 0.12, cx, ym, x0, ym); quad(x0, ym, cx, ym, cx, ym + h * 0.12); l(cx, y1 - h * 0.2); quad(cx, y1 - h * 0.2, cx, y1, x1, y1); break; }
    case 'axis': l(x0, y0); l(x0, y1); l(x1, y1); head(x0, y0, -Math.PI / 2, 12); head(x1, y1, 0, 12); break;
    case 'graph': l(x0, cy); l(x1, cy); head(x1, cy, 0, 12); m(cx, y1); l(cx, y0); head(cx, y0, -Math.PI / 2, 12);
      for (let i = 1; i < 6; i++) { const tx = x0 + (w * i) / 6, ty = y0 + (h * i) / 6; m(tx, cy - 4); l(tx, cy + 4); m(cx - 4, ty); l(cx + 4, ty); } break;
    case 'table': l(x0, y0); l(x1, y0); l(x1, y1); l(x0, y1); l(x0, y0);
      for (let i = 1; i < 3; i++) { m(x0 + (w * i) / 3, y0); l(x0 + (w * i) / 3, y1); m(x0, y0 + (h * i) / 3); l(x1, y0 + (h * i) / 3); } break;
    default: l(ax, ay); l(bx, by);
  }
  return P;
}
