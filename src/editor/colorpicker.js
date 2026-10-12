// HSB + HEX color picker popover with opacity, eyedropper and favorites.
import { h } from '../core/utils.js';
import { popover, pref } from './ui.js';
import { icon } from './icons.js';

const hex2rgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(x || ''); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, mx ? d / mx : 0, mx];
}
function hsv2rgb(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
  return [f(5), f(3), f(1)];
}

export function openColorPicker(anchor, { color = '#000000', alpha = 1, withAlpha = true, onChange }) {
  let [hh, s, v] = rgb2hsv(...hex2rgb(color)), a = alpha;
  const W = 220, H = 140;
  const sv = h('canvas', { width: W, height: H, class: 'ik-sv' });
  const hue = h('input', { type: 'range', min: 0, max: 360, value: hh, class: 'ik-range ik-hue', 'aria-label': 'Hue' });
  const al = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: a, class: 'ik-range', 'aria-label': 'Opacity' });
  const hexIn = h('input', { type: 'text', maxlength: 7, class: 'ik-hex', 'aria-label': 'Hex color' });
  const fav = h('div', { class: 'ik-colors' });
  const cur = () => rgb2hex(...hsv2rgb(hh, s, v));
  const paintSv = () => {
    const c = sv.getContext('2d');
    c.fillStyle = `hsl(${hh},100%,50%)`; c.fillRect(0, 0, W, H);
    let g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.beginPath(); c.arc(s * W, (1 - v) * H, 7, 0, 6.28); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); c.strokeStyle = '#0006'; c.lineWidth = 1; c.stroke();
  };
  const emit = () => { hexIn.value = cur(); paintSv(); onChange?.(cur(), a); };
  const favs = () => pref.get('favcolors', []);
  const paintFav = () => {
    fav.replaceChildren(...favs().map((c) => h('button', { type: 'button', class: 'ik-sw', style: { background: c }, 'aria-label': 'Favorite ' + c, onclick: () => { [hh, s, v] = rgb2hsv(...hex2rgb(c)); hue.value = hh; emit(); } })));
  };
  const pick = (e) => { const r = sv.getBoundingClientRect(); s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); emit(); };
  sv.addEventListener('pointerdown', (e) => { sv.setPointerCapture(e.pointerId); pick(e); sv.onpointermove = pick; });
  sv.addEventListener('pointerup', () => { sv.onpointermove = null; });
  hue.addEventListener('input', () => { hh = +hue.value; emit(); });
  al.addEventListener('input', () => { a = +al.value; emit(); });
  hexIn.addEventListener('change', () => { if (/^#?[0-9a-f]{6}$/i.test(hexIn.value)) { [hh, s, v] = rgb2hsv(...hex2rgb(hexIn.value)); hue.value = hh; emit(); } });
  const eye = window.EyeDropper ? h('button', { type: 'button', class: 'ik-btn sm', title: 'Pick color from screen', 'aria-label': 'Eyedropper', onclick: async () => { try { const r = await new window.EyeDropper().open(); [hh, s, v] = rgb2hsv(...hex2rgb(r.sRGBHex)); hue.value = hh; emit(); } catch { /* cancelled */ } } }, icon('pen', 18)) : null;
  const star = h('button', { type: 'button', class: 'ik-btn sm', title: 'Save as favorite', 'aria-label': 'Save favorite', onclick: () => { const l = favs().filter((x) => x !== cur()); pref.set('favcolors', [cur(), ...l].slice(0, 10)); paintFav(); } }, icon('star', 18));
  const box = h('div', { class: 'ik-picker' }, sv, hue, withAlpha ? al : null, h('div', { class: 'ik-hexrow' }, hexIn, eye, star), fav);
  paintFav(); hexIn.value = cur(); paintSv();
  return popover(anchor, box, { cls: 'picker' });
}
