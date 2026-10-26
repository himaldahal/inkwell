// Calibration modal: a practice pad that measures pressure range and hand steadiness, then proposes (and applies) smoothing.
import { h, openModal } from './dom.js';
import { toast } from '../core/store.js';
import { getSetting, setSetting } from '../core/settings.js';
import { createInkFilter } from '../editor/tools/smooth.js';
import { summarize, DEVICE_NAME, smoothFromJitter } from '../editor/calib.js';

export function calibrationSummary() {
  const c = getSetting('editor.calib');
  if (!c || !c.at) return 'Not calibrated yet. It also tunes itself while you write.';
  const parts = [];
  if (c.smoothBy) parts.push(Object.entries(c.smoothBy).map(([t, v]) => `${DEVICE_NAME[t] || t}: ${v}% smoothing`).join(', '));
  if (c.pmax && c.pmax < 1 && c.pmin != null) parts.push(`pen pressure ${Math.round(c.pmin * 100)}-${Math.round(c.pmax * 100)}%`);
  return parts.join(' · ') || 'Calibrated.';
}

export function openCalibration() {
  const strokes = [];
  let live = null, smooth = null; // smooth: user-adjusted % for the preview (null = use the measured suggestion)
  const cv = h('canvas', { class: 'cal-pad', 'aria-label': 'Practice area' });
  const out = h('div', { class: 'cal-out' });
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: 40, 'aria-label': 'Smoothing preview', class: 'cal-range' });
  const sval = h('output', {}, '40%');
  const info = h('p', { class: 'hint' }, 'Write or draw on the pad for about ten seconds: a slow straight line, a few circles, some handwriting. With a pencil, press lightly and then firmly. Grey is what your device reports, the coloured line is what Inkwell draws.');
  let res = null;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, hh = cv.clientHeight;
    if (!w) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); paint();
  }
  function pct() { return smooth ?? res?.smooth ?? 40; }
  function strokePath(ctx, pts, color, width, alpha) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function filtered(s) {
    const f = createInkFilter(s.type, pct() / 100), r = cv.getBoundingClientRect(), pts = [];
    for (let i = 0; i < s.xy.length; i += 3) { const x = s.xy[i] - r.left, y = s.xy[i + 1] - r.top; pts.push(i === 0 ? (f.reset(x, y, s.xy[i + 2]), { x, y }) : f.step(x, y, s.xy[i + 2], 1)); }
    return pts;
  }
  function paint() {
    const ctx = cv.getContext('2d'), w = cv.clientWidth, hh = cv.clientHeight, r = cv.getBoundingClientRect();
    ctx.clearRect(0, 0, w, hh);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5';
    for (const s of [...strokes, ...(live ? [live] : [])]) {
      const raw = []; for (let i = 0; i < s.xy.length; i += 3) raw.push({ x: s.xy[i] - r.left, y: s.xy[i + 1] - r.top });
      strokePath(ctx, raw, '#8a8f9c', 1, 0.8); strokePath(ctx, filtered(s), accent, 2.6, 1);
    }
  }
  function measure() {
    res = strokes.length ? summarize(strokes) : null;
    if (res && smooth == null) { slider.value = res.smooth ?? 40; sval.textContent = (res.smooth ?? 40) + '%'; }
    const rows = res ? [
      ['Input', DEVICE_NAME[res.type] || res.type], ['Strokes measured', String(res.strokes)],
      ['Pressure', res.type === 'pen' ? (res.hasPressure ? `${Math.round(res.pmin * 100)}% to ${Math.round(res.pmax * 100)}% (will be stretched to the full range)` : 'not reported by this device') : 'not applicable'],
      ['Steadiness', res.jitter == null ? 'draw a slow line to measure' : res.jitter < 0.3 ? 'very steady' : res.jitter < 0.7 ? 'steady' : res.jitter < 1.2 ? 'a little shaky' : 'shaky'],
      ['Suggested smoothing', res.smooth == null ? '-' : res.smooth + '%'], ['Report rate', res.rate ? res.rate + ' points per second' : '-'],
    ] : [];
    out.replaceChildren(...rows.map(([k, v]) => h('div', { class: 'cal-row' }, h('span', {}, k), h('b', {}, v))));
    apply.disabled = !res; paint();
  }
  const begin = (e) => {
    if (live) return; e.preventDefault(); cv.setPointerCapture(e.pointerId);
    live = { type: e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse', xy: [], ps: [] }; add(e);
  };
  const add = (e) => {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; for (const c of evs.length ? evs : [e]) { live.xy.push(c.clientX, c.clientY, c.timeStamp); live.ps.push(c.pressure || 0); }
    paint();
  };
  cv.addEventListener('pointerdown', begin);
  cv.addEventListener('pointermove', (e) => { if (live && e.pointerId !== undefined) add(e); });
  const end = () => { if (!live) return; if (live.xy.length > 12) strokes.push(live); live = null; measure(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  slider.addEventListener('input', () => { smooth = +slider.value; sval.textContent = smooth + '%'; paint(); });
  const clear = h('button', { class: 'btn ghost', type: 'button', onclick: () => { strokes.length = 0; smooth = null; measure(); } }, 'Clear pad');
  const apply = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Save calibration');
  const m = openModal({
    title: 'Calibrate pen & touch', size: 'lg', className: 'cal',
    body: [info, h('div', { class: 'cal-padwrap' }, cv), h('div', { class: 'cal-slide' }, h('label', {}, 'Smoothing preview'), slider, sval), out],
    actions: [{ label: 'Cancel', kind: 'ghost' }],
  });
  m.el.querySelector('.modal-foot')?.prepend(clear); m.el.querySelector('.modal-foot')?.append(apply);
  apply.addEventListener('click', async () => {
    if (!res) return;
    const old = getSetting('editor.calib') || {};
    const next = { ...old, at: Date.now(), smoothBy: { ...(old.smoothBy || {}), [res.type]: pct() }, jitter: { ...(old.jitter && typeof old.jitter === 'object' ? old.jitter : {}), [res.type]: res.jitter } };
    if (res.type === 'pen') { next.pmin = res.hasPressure ? res.pmin : 0; next.pmax = res.hasPressure ? res.pmax : 1; }
    await setSetting('editor.calib', next); await setSetting('editor.smoothingAuto', true);
    toast('Calibration saved'); m.close(true);
  });
  requestAnimationFrame(size); window.addEventListener('resize', size);
  m.closed.then(() => window.removeEventListener('resize', size));
  void smoothFromJitter;
  return m;
}

/** quick pen & touch settings in a modal (same switches as Settings > Pen & touch) */
export function openPenSettings() {
  const row = (label, hint, ctl) => h('div', { class: 'set-row' }, h('div', { class: 'set-lab' }, h('b', {}, label), hint && h('small', {}, hint)), h('div', { class: 'set-ctl' }, ctl));
  const sw = (key, def = true) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: getSetting(key) ?? def, onchange: (e) => setSetting(key, e.target.checked) }), h('span', {}));
  const range = (key, min, max, step, unit, def) => { const v = getSetting(key) ?? def, out = h('output', {}, v + unit); return h('div', { class: 'range' }, h('input', { type: 'range', min, max, step, value: v, oninput: (e) => { out.textContent = e.target.value + unit; setSetting(key, +e.target.value); } }), out); };
  const seg = (key, opts) => { const box = h('div', { class: 'seg' }); const paint = () => box.replaceChildren(...opts.map(([k, l]) => h('button', { type: 'button', class: getSetting(key) === k ? 'on' : '', onclick: async () => { await setSetting(key, k); paint(); } }, l))); paint(); return box; };
  const sum = h('small', {}, calibrationSummary());
  const m = openModal({
    title: 'Pen & touch', size: 'md',
    body: [
      h('div', { class: 'set-row' }, h('div', { class: 'set-lab' }, h('b', {}, 'Calibration'), sum), h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { m.close(); setTimeout(openCalibration, 180); } }, 'Calibrate...'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await setSetting('editor.calib', null); sum.textContent = calibrationSummary(); toast('Calibration reset'); } }, 'Reset'))),
      row('Calibrate automatically', 'Learns from your writing', sw('editor.autoCalibrate')),
      row('Automatic smoothing', 'Per input: pencil, finger, mouse', sw('editor.smoothingAuto')),
      row('Manual smoothing', 'When automatic is off', range('editor.smoothing', 0, 100, 5, '%', 40)),
      row('Pressure feel', null, seg('editor.pressureCurve', [['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']])),
      row('Pen prediction', 'Hides lag', sw('editor.prediction')),
      row('Zoom speed', 'Pinch, trackpad and wheel', range('editor.zoomSpeed', 50, 200, 10, '%', 100)),
      row('Momentum scrolling', null, sw('editor.momentum')), row('Double-tap to zoom', 'Hand tool', sw('editor.smartZoom')),
    ],
    actions: [{ label: 'Done', kind: 'primary' }],
  });
  return m;
}
