import { getMeta, setMeta } from './db.js';
import { emit } from './store.js';

export const DEFAULTS = {
  theme: 'system',          // system | light | dark | sepia
  accent: '#FF9F0A',
  paperTone: 'warm',        // warm | neutral | cool
  fontSize: 'medium',       // small | medium | large
  reducedMotion: false,
  highContrast: false,
  defaultTemplate: 'lined',
  defaultPaper: null,
  pen: { tool: 'pen', color: '#1f2937', size: 3 },
  view: 'grid',             // grid | list
  sort: 'updated',          // updated | created | title
  sortDir: 'desc',
  groupBy: 'none',          // none | date | notebook
  sidebarCollapsed: false,
  expanded: {},
  tipsDismissed: false,
  appLock: false,
};
let cur = { ...DEFAULTS, pen: { ...DEFAULTS.pen }, expanded: {} };
export const getSettings = () => cur;

function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function applySettings(s = cur) {
  const r = document.documentElement;
  r.setAttribute('data-theme', s.theme);
  r.setAttribute('data-paper', s.paperTone);
  r.setAttribute('data-contrast', s.highContrast ? 'high' : 'normal');
  r.setAttribute('data-motion', s.reducedMotion ? 'reduce' : 'auto');
  r.style.setProperty('--accent', s.accent);
  r.style.setProperty('--on-accent', lum(s.accent) > 0.62 ? '#14121f' : '#ffffff');
  r.style.fontSize = { small: '15px', medium: '16px', large: '18px' }[s.fontSize] || '16px';
  try { localStorage.setItem('inkwell:boot', JSON.stringify({ theme: s.theme, accent: s.accent })); } catch { /* ignore */ }
  requestAnimationFrame(() => {
    const bg = getComputedStyle(r).getPropertyValue('--bg').trim();
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.append(m); }
    if (bg) m.content = bg;
  });
}
export async function loadSettings() {
  const saved = (await getMeta('settings', {})) || {};
  cur = { ...DEFAULTS, ...saved, pen: { ...DEFAULTS.pen, ...(saved.pen || {}) }, expanded: { ...(saved.expanded || {}) } };
  applySettings();
  return cur;
}
export async function updateSettings(patch) {
  cur = { ...cur, ...patch };
  applySettings();
  emit('settings:changed', cur);
  await setMeta('settings', cur);
  return cur;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applySettings());
