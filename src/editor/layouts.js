// Layout templates: compact drawing ops (coordinates in % of the page) rendered onto the paper behind the ink.
// Ops: t title | f field | b box | l lines | c checks | g table | v/h rules | d dots | gr grid | o ellipse | tx text | ax axes | ln line | cal calendar
const rr = (c, x, y, w, h, r) => { // rounded rect path that also works on older Safari (no ctx.roundRect)
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)); c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
};

export function drawLayout(ctx, w, h, ops, dark) {
  const P = {
    ink: dark ? '#e8eaf2' : '#1f2a44', mute: dark ? 'rgba(232,234,242,.55)' : 'rgba(31,42,68,.55)',
    line: dark ? 'rgba(255,255,255,.22)' : 'rgba(31,42,68,.24)', soft: dark ? 'rgba(165,180,252,.10)' : 'rgba(79,70,229,.07)', acc: dark ? '#a5b4fc' : '#4f46e5',
  };
  const X = (v) => (v * w) / 100, Y = (v) => (v * h) / 100;
  const u = Math.min(w, h * 0.7) / 820; // type scales with the page
  ctx.save(); ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  const label = (t, x, y, o = {}) => {
    ctx.font = `${o.b ? 700 : 600} ${(o.s || 11) * u}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = o.c || P.mute; ctx.textAlign = o.a || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(o.up ? String(t).toUpperCase() : t, x, y);
  };
  const OPS = {
    t(t, sub) {
      label(t, X(6), Y(6.4), { s: 30, b: 1, c: P.ink });
      ctx.fillStyle = P.acc; rr(ctx, X(6), Y(6.4) + 12 * u, 46 * u, 4 * u, 2 * u); ctx.fill();
      if (sub) label(sub, X(94), Y(6.4), { s: 12, a: 'right' });
    },
    tx(t, x, y, s = 12, tone = 'm', a = 'left') { label(t, X(x), Y(y), { s, b: tone === 'i' || tone === 'a', c: tone === 'i' ? P.ink : tone === 'a' ? P.acc : P.mute, a }); },
    f(t, x, y, ww) { ctx.strokeStyle = P.line; ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + ww), Y(y)); ctx.stroke(); label(t, X(x), Y(y) - 5 * u, { s: 10.5, up: 1 }); },
    b(x, y, ww, hh, t, fill) {
      rr(ctx, X(x), Y(y), X(ww), Y(hh), 12 * u); if (fill) { ctx.fillStyle = P.soft; ctx.fill(); } ctx.strokeStyle = P.line; ctx.stroke();
      if (t) label(t, X(x) + 14 * u, Y(y) + 22 * u, { s: 11, b: 1, c: P.acc, up: 1 });
    },
    l(x, y, ww, n, gap = 30) { ctx.strokeStyle = P.line; ctx.beginPath(); for (let i = 0; i < n; i++) { ctx.moveTo(X(x), Y(y) + i * gap * u); ctx.lineTo(X(x + ww), Y(y) + i * gap * u); } ctx.stroke(); },
    c(x, y, ww, n, gap = 34) {
      ctx.strokeStyle = P.line; ctx.beginPath();
      for (let i = 0; i < n; i++) { const yy = Y(y) + i * gap * u; rr(ctx, X(x), yy - 14 * u, 15 * u, 15 * u, 4 * u); ctx.moveTo(X(x) + 24 * u, yy); ctx.lineTo(X(x + ww), yy); }
      ctx.stroke();
    },
    g(x, y, ww, hh, cols, rows, o = {}) {
      const cw = Array.isArray(cols) ? cols : Array(cols).fill(1), cs = cw.reduce((a, b) => a + b, 0), x0 = X(x), y0 = Y(y), W = X(ww), H = Y(hh), hh0 = o.hh ? o.hh * u : 0;
      const bodyH = H - hh0, rh = bodyH / rows;
      if (o.head) { ctx.fillStyle = P.soft; rr(ctx, x0, y0, W, hh0 || rh, 8 * u); ctx.fill(); }
      ctx.strokeStyle = P.line; rr(ctx, x0, y0, W, H, 8 * u); ctx.stroke(); ctx.beginPath();
      for (let r = 1; r < rows; r++) { ctx.moveTo(x0, y0 + hh0 + r * rh); ctx.lineTo(x0 + W, y0 + hh0 + r * rh); }
      if (hh0) { ctx.moveTo(x0, y0 + hh0); ctx.lineTo(x0 + W, y0 + hh0); }
      let acc = 0; for (let i = 0; i < cw.length - 1; i++) { acc += cw[i]; const xx = x0 + (W * acc) / cs; ctx.moveTo(xx, y0); ctx.lineTo(xx, y0 + H); }
      ctx.stroke();
      if (o.head) { acc = 0; cw.forEach((c0, i) => { const cx = x0 + (W * (acc + c0 / 2)) / cs; acc += c0; if (o.head[i]) label(o.head[i], cx, y0 + (hh0 || rh) / 2 + 4 * u, { s: 10.5, b: 1, c: P.acc, a: 'center', up: 1 }); }); }
      if (o.rows) o.rows.forEach((t, r) => { if (t) label(t, x0 + 10 * u, y0 + hh0 + r * rh + rh / 2 + 4 * u, { s: 11, b: 1, c: P.ink }); });
    },
    v(x, y, hh) { ctx.strokeStyle = P.line; ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x), Y(y + hh)); ctx.stroke(); },
    h(x, y, ww) { ctx.strokeStyle = P.line; ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + ww), Y(y)); ctx.stroke(); },
    d(x, y, ww, hh, step = 24) { ctx.fillStyle = P.line; for (let yy = Y(y); yy <= Y(y + hh); yy += step * u) for (let xx = X(x); xx <= X(x + ww); xx += step * u) ctx.fillRect(xx - 1, yy - 1, 2, 2); },
    gr(x, y, ww, hh, step = 24) { ctx.strokeStyle = P.line; ctx.lineWidth = 0.7; ctx.beginPath(); for (let yy = Y(y); yy <= Y(y + hh) + 0.5; yy += step * u) { ctx.moveTo(X(x), yy); ctx.lineTo(X(x + ww), yy); } for (let xx = X(x); xx <= X(x + ww) + 0.5; xx += step * u) { ctx.moveTo(xx, Y(y)); ctx.lineTo(xx, Y(y + hh)); } ctx.stroke(); ctx.lineWidth = 1.2; },
    o(x, y, rx, ry, t, fill) { ctx.beginPath(); ctx.ellipse(X(x), Y(y), rx * u, (ry || rx) * u, 0, 0, 6.2832); if (fill) { ctx.fillStyle = P.soft; ctx.fill(); } ctx.strokeStyle = P.acc; ctx.stroke(); if (t) label(t, X(x), Y(y) + 4 * u, { s: 11, b: 1, c: P.acc, a: 'center', up: 1 }); },
    ln(x1, y1, x2, y2, dash) { ctx.strokeStyle = P.line; if (dash) ctx.setLineDash([6 * u, 5 * u]); ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke(); ctx.setLineDash([]); },
    ax(x, y, ww, hh, step = 24) {
      OPS.gr(x, y, ww, hh, step); const cx = X(x + ww / 2), cy = Y(y + hh / 2); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(X(x), cy); ctx.lineTo(X(x + ww), cy); ctx.moveTo(cx, Y(y)); ctx.lineTo(cx, Y(y + hh)); ctx.stroke(); ctx.lineWidth = 1.2;
      label('x', X(x + ww) - 10 * u, cy - 8 * u, { s: 12, b: 1, c: P.ink }); label('y', cx + 8 * u, Y(y) + 12 * u, { s: 12, b: 1, c: P.ink });
    },
    cal(x, y, ww, hh, cols = 7, rows = 5, heads) {
      OPS.g(x, y, ww, hh, cols, rows, { head: heads || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, cols), hh: 30 });
    },
  };
  for (const [k, ...a] of ops) OPS[k]?.(...a);
  ctx.restore();
}
