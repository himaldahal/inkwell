// Adaptive input smoothing (One Euro filter): steady lines when moving slowly, almost no lag when moving fast.
const TAU = Math.PI * 2;
const alpha = (cutoff, dt) => 1 / (1 + 1 / (TAU * cutoff * dt));

// pen = Apple Pencil / stylus (already clean, high rate); touch and mouse are noisier
const PROFILE = { pen: { min: 3.4, beta: 0.05 }, touch: { min: 1.5, beta: 0.035 }, mouse: { min: 1.3, beta: 0.03 } };

/** user smoothing 0..1 (0.4 = the default feel) -> multiplier on the filter cut-off: lower = smoother */
export const strengthFactor = (s01) => Math.pow(3, (0.4 - Math.min(1, Math.max(0, s01))) * 2.5);

export function createInkFilter(type = 'mouse', s01 = 0.4) {
  const B = PROFILE[type] || PROFILE.mouse, k = strengthFactor(s01), P = { min: B.min * k, beta: B.beta * k };
  let x = 0, y = 0, dx = 0, dy = 0, t = 0, started = false;
  return {
    reset(px, py, pt) { x = px; y = py; dx = dy = 0; t = pt || 0; started = true; },
    /** feed a raw point (page units); `zoom` converts page units to screen px so the speed is zoom independent */
    step(px, py, pt, zoom = 1) {
      if (!started) { this.reset(px, py, pt); return { x: px, y: py }; }
      const dt = Math.min(0.05, Math.max(1 / 480, ((pt || t + 8) - t) / 1000)); t = pt || t + 8;
      const vx = ((px - x) / dt) * zoom, vy = ((py - y) / dt) * zoom;
      const ad = alpha(1, dt); dx += (vx - dx) * ad; dy += (vy - dy) * ad;
      const cutoff = P.min + P.beta * Math.hypot(dx, dy), a = alpha(cutoff, dt);
      x += (px - x) * a; y += (py - y) * a;
      return { x, y };
    },
  };
}
