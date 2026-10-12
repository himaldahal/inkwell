// Straightedge ruler overlay with angle snap guides. Pen strokes that start near its edge snap to it (see Engine.applyRuler).
import { h } from '../core/utils.js';

export function mountRuler(engine) {
  const wrap = engine.wrap;
  const label = h('span', { class: 'ik-ruler-label' }, '0°');
  const grip = h('div', { class: 'ik-ruler-grip', 'data-ik-ui': '', title: 'Drag to move the ruler', role: 'button', 'aria-label': 'Move ruler' });
  const rot = h('div', { class: 'ik-ruler-rot', 'data-ik-ui': '', title: 'Drag to rotate', role: 'button', 'aria-label': 'Rotate ruler' });
  const el = h('div', { class: 'ik-ruler', hidden: true }, h('div', { class: 'ik-ruler-body' }), grip, rot, label);
  wrap.append(el);
  const R = engine.ruler = { on: false, x: 0, y: 0, a: 0, len: 560 };
  function paint() {
    el.style.width = R.len + 'px'; el.style.transform = `translate(${R.x}px,${R.y}px) rotate(${R.a}rad)`;
    let deg = ((R.a * 180) / Math.PI) % 180; if (deg < 0) deg += 180;
    label.textContent = Math.round(deg) + '°';
    el.classList.toggle('guide', [0, 45, 90, 135, 180].some((g) => Math.abs(deg - g) < 0.6));
    label.style.transform = `rotate(${-R.a}rad)`;
  }
  function drag(node, onMove) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); node.setPointerCapture(e.pointerId);
      const mv = (ev) => onMove(ev);
      const up = () => { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); };
      node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
    });
  }
  drag(grip, (ev) => { const r = wrap.getBoundingClientRect(); R.x = ev.clientX - r.left; R.y = ev.clientY - r.top; paint(); });
  drag(rot, (ev) => {
    const r = wrap.getBoundingClientRect();
    let a = Math.atan2(ev.clientY - r.top - R.y, ev.clientX - r.left - R.x);
    const step = Math.PI / 12, near = Math.round(a / step) * step;
    if (Math.abs(a - near) < 0.055) a = near;          // snap guide every 15 degrees
    R.a = a; paint();
  });
  return {
    toggle(on = !R.on) {
      R.on = on; el.hidden = !on;
      if (on) { const r = wrap.getBoundingClientRect(); if (!R.x) { R.x = r.width / 2; R.y = r.height / 2; } R.len = Math.min(640, r.width * 0.85); paint(); }
      engine.emit('ruler', on);
    },
    destroy() { el.remove(); engine.ruler = null; },
  };
}
