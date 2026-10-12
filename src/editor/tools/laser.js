// Laser pointer: a glowing dot with a fading trail on a screen-space overlay. Nothing is stored.
import { h } from '../../core/utils.js';

export function createLaserTool(engine) {
  let cv, ctx, trail = [], raf = 0, down = false, dpr = 1;
  function ensure() {
    if (!cv) { cv = h('canvas', { class: 'ik-laser' }); engine.wrap.append(cv); ctx = cv.getContext('2d'); }
    const r = engine.wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  }
  function loop() {
    raf = 0; const now = performance.now(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    trail = trail.filter((p) => now - p.t < 650);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i], f = 1 - (now - b.t) / 650;
      ctx.strokeStyle = `rgba(255,45,85,${f * 0.8})`; ctx.lineWidth = 3 + 6 * f;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const head = trail[trail.length - 1];
    if (head && (down || now - head.t < 120)) {
      ctx.shadowColor = 'rgba(255,45,85,.9)'; ctx.shadowBlur = 18; ctx.fillStyle = '#ff2d55';
      ctx.beginPath(); ctx.arc(head.x, head.y, 8, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (trail.length) raf = requestAnimationFrame(loop);
  }
  const add = (pt) => {
    const r = engine.wrap.getBoundingClientRect();
    trail.push({ x: pt.cx - r.left, y: pt.cy - r.top, t: performance.now() });
    if (!raf) raf = requestAnimationFrame(loop);
  };
  return {
    cursor: 'crosshair',
    activate() { ensure(); },
    down(pt) { ensure(); down = true; add(pt); },
    move(pt) { add(pt); },
    up() { down = false; },
    cancel() { down = false; },
    destroy() { cancelAnimationFrame(raf); cv?.remove(); },
  };
}
