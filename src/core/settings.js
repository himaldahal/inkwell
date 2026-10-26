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
  density: 'comfortable', radius: 'medium', uiFont: 'system', iconStyle: 'regular', iconSize: 'medium', badge: false,
  cardSize: 'medium', showPreviews: true, showDates: true, showTags: true, defaultNotebook: null, confirmDelete: false,
  pageSize: 'a4',
  editor: {
    canvasColor: '#E5E8EE', pageColor: '#FFFFFF',
    highlighter: { color: '#FFD60A', size: 14 }, eraser: { size: 12, mode: 'stroke' },
    palmRejection: 'auto',       // off | auto | strict
    inputMode: 'any',            // any | pencil-only
    smoothing: 40, pressureCurve: 'normal', // soft | normal | firm
    smoothingAuto: true, autoCalibrate: true, calib: null, // calib: { pmin, pmax, smoothBy: { pen, touch, mouse }, ... } learned from the user's writing
    prediction: true, zoomSpeed: 100, momentum: true, smartZoom: true, snapDelay: 520,
    zoom: 'pinch', snap: false, guides: false, scrollDir: 'vertical', autoScroll: true,
    twoFinger: 'pan-zoom',       // pan-zoom | undo | none
    toolbarPos: 'top', toolbarAutoHide: false, leftHanded: false, haptics: true,
  },
  typing: { font: 'sans', size: 16, spellcheck: true, autocorrect: true },
  voice: { name: '', rate: 1, pitch: 1, dictLang: 'en-US' },
  sync: { interval: 30, wifiOnlyLarge: false, background: true, conflict: 'newest' },
  autoLockSecs: 10, hidePreviews: false,
  notif: { inApp: true, emailShare: true, emailDigest: false },
  a11y: { largeUI: false, dyslexia: false, srHints: false, colorBlind: 'none' },
  region: { language: 'en', dateFormat: 'auto', timeFormat: 'auto', weekStart: 'sun' },
  shortcuts: {}, offlineNotebooks: {}, devMode: false, modules: {},
};
let cur = { ...DEFAULTS, pen: { ...DEFAULTS.pen }, expanded: {} };
export const getSettings = () => cur;
/** getSetting('editor.palmRejection') */
export const getSetting = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), cur);
const defaultOf = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), DEFAULTS);
/** setSetting('editor.palmRejection', 'strict') -> persists, applies and emits settings:changed */
export function setSetting(path, value) {
  const keys = path.split('.'); const root = { ...cur }; let o = root;
  for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = { ...(o[keys[i]] || {}) }; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
  return updateSettings(root);
}
export const resetSettings = (paths) => { const root = { ...cur }; for (const p of paths) { const keys = p.split('.'); let o = root; for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = { ...(o[keys[i]] || {}) }; o = o[keys[i]]; } o[keys[keys.length - 1]] = structuredClone(defaultOf(p)); } return updateSettings(root); };

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
  const big = s.a11y?.largeUI ? 1.12 : 1;
  r.style.fontSize = ({ small: 15, medium: 16, large: 18 }[s.fontSize] || 16) * big + 'px';
  r.setAttribute('data-density', s.density); r.setAttribute('data-cb', s.a11y?.colorBlind || 'none');
  r.style.setProperty('--radius', { small: '8px', medium: '14px', large: '22px' }[s.radius] || '14px');
  r.style.setProperty('--icon-stroke', { light: 1.4, regular: 1.8, bold: 2.4 }[s.iconStyle] || 1.8);
  r.style.setProperty('--icon-scale', { small: .9, medium: 1, large: 1.15 }[s.iconSize] || 1);
  r.style.setProperty('--card-min', { small: '130px', medium: '168px', large: '220px' }[s.cardSize] || '168px');
  const ff = s.a11y?.dyslexia ? 'dyslexia' : s.uiFont;
  r.style.setProperty('--font', { system: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', serif: 'Georgia, "Iowan Old Style", serif', mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', dyslexia: '"OpenDyslexic", "Atkinson Hyperlegible", "Comic Sans MS", "Trebuchet MS", sans-serif' }[ff]);
  const ed = s.editor || {};
  if (ed.canvasColor && ed.canvasColor.toLowerCase() !== '#e5e8ee') r.style.setProperty('--canvas', ed.canvasColor); else r.style.removeProperty('--canvas');
  if (ed.pageColor && ed.pageColor.toLowerCase() !== '#ffffff') r.style.setProperty('--page', ed.pageColor); else r.style.removeProperty('--page');
  for (const [k, v] of [['previews', s.showPreviews], ['dates', s.showDates], ['tags', s.showTags]]) r.toggleAttribute('data-hide-' + k, !v);
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
  for (const k of ['editor', 'typing', 'voice', 'sync', 'notif', 'a11y', 'region']) cur[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
  cur.editor.highlighter = { ...DEFAULTS.editor.highlighter, ...(saved.editor?.highlighter || {}) }; cur.editor.eraser = { ...DEFAULTS.editor.eraser, ...(saved.editor?.eraser || {}) };
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
