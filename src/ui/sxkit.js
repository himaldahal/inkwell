// Shared bits for the account / sharing / admin UIs: themed CSS (uses the app's CSS variables) and tiny helpers.
import { h } from '../core/utils.js';
import { avatarUrl } from '../core/sync.js';

const CSS = `
.sx{color:var(--text,#1c1c1e);font:inherit;display:grid;gap:14px;width:100%}.sx *{box-sizing:border-box}
.sx-card{background:var(--surface,#fff);border:1px solid var(--border,rgba(0,0,0,.1));border-radius:var(--radius,14px);padding:16px;display:grid;gap:12px;box-shadow:var(--shadow-1,none)}
.sx h2,.sx h3{margin:0}.sx h3{font-size:1rem}.sx p{margin:0;color:var(--muted,#8e8e93);font-size:.875rem;line-height:1.45}
.sx label{display:grid;gap:4px;font-size:.78rem;color:var(--muted,#8e8e93)}
.sx input[type=text],.sx input[type=password],.sx input[type=email],.sx input[type=url],.sx input[type=number],.sx input[type=search],.sx input[type=datetime-local],.sx select,.sx textarea{width:100%;min-height:44px;padding:10px 12px;border-radius:10px;border:1px solid var(--border,rgba(0,0,0,.14));background:var(--surface-2,#f2f2f7);color:var(--text,#1c1c1e);font:inherit}
.sx input:focus-visible,.sx button:focus-visible,.sx select:focus-visible{outline:2px solid var(--accent,#ff9f0a);outline-offset:2px}
.sx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.sx-grow{flex:1 1 160px}
.sx-btn{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--border,rgba(0,0,0,.14));background:var(--surface,#fff);color:var(--text,#1c1c1e);font:inherit;cursor:pointer}
.sx-btn.sm{min-height:34px;padding:0 10px;font-size:.82rem}.sx-btn.primary{background:var(--accent,#ff9f0a);border-color:transparent;color:var(--on-accent,#fff);font-weight:600}
.sx-btn.danger{color:var(--danger,#ff3b30);border-color:currentColor}.sx-btn[disabled]{opacity:.5;cursor:default}
.sx-tabs{display:flex;gap:4px;background:var(--surface-2,#f2f2f7);border-radius:10px;padding:3px;overflow-x:auto}
.sx-tabs button{flex:1 0 auto;min-height:36px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--muted,#8e8e93);font:inherit;cursor:pointer;white-space:nowrap}
.sx-tabs button[aria-selected=true]{background:var(--surface,#fff);color:var(--text,#1c1c1e);box-shadow:var(--shadow-1,0 1px 3px rgba(0,0,0,.12))}
.sx-err{color:var(--danger,#ff3b30);font-size:.85rem}.sx-ok{color:var(--ok,#248a3d);font-size:.85rem}
.sx-warn{background:color-mix(in srgb,var(--warn,#c77700) 14%,transparent);border:1px solid color-mix(in srgb,var(--warn,#c77700) 45%,transparent);border-radius:10px;padding:10px 12px;font-size:.82rem}
.sx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.sx-stat{background:var(--surface-2,#f2f2f7);border-radius:10px;padding:10px 12px}.sx-stat b{display:block;font-size:1.15rem}.sx-stat span{font-size:.74rem;color:var(--muted,#8e8e93)}
.sx-badge{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;padding:2px 9px;border-radius:99px;background:var(--surface-2,#f2f2f7);white-space:nowrap}
.sx-badge.ok{color:var(--ok,#248a3d)}.sx-badge.bad{color:var(--danger,#ff3b30)}.sx-badge.warn{color:var(--warn,#c77700)}
.sx-av{border-radius:50%;display:inline-grid;place-items:center;color:#fff;font-weight:600;overflow:hidden;flex:none;background-size:cover;background-position:center}
.sx-list>div{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--border,rgba(0,0,0,.08))}.sx-list>div:first-child{border-top:0}
.sx-list small{display:block;color:var(--muted,#8e8e93)}
.sx-table{width:100%;border-collapse:separate;border-spacing:0;font-size:.84rem}.sx-tw{overflow:auto;max-height:60vh;border:1px solid var(--border,rgba(0,0,0,.1));border-radius:10px}
.sx-table th{position:sticky;top:0;background:var(--surface-2,#f2f2f7);text-align:left;padding:8px 10px;font-weight:600;white-space:nowrap;z-index:1}
.sx-table td{padding:8px 10px;border-top:1px solid var(--border,rgba(0,0,0,.08));vertical-align:middle}.sx-table tr:hover td{background:color-mix(in srgb,var(--accent,#ff9f0a) 6%,transparent)}
.sx-center{min-height:100%;display:grid;place-items:center;padding:24px 16px}.sx-narrow{max-width:420px;margin:0 auto;width:100%}
.sx-brand{display:flex;align-items:center;gap:10px;justify-content:center;font-size:1.4rem;font-weight:700;margin-bottom:6px}
.sx-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.sx-spark{width:100%;height:56px}
`;
export function ensureCss() {
  if (document.getElementById('sx-style')) return;
  document.head.append(h('style', { id: 'sx-style' }, CSS));
}
export const initials = (name = '?') => (name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();
export function colorFor(s = '') { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${x % 360} 55% 48%)`; }
/** Avatar: uploaded image if the viewer may see it, otherwise initials on a deterministic colour. */
export function avatarEl(user, size = 32) {
  const name = user?.name || user?.displayName || user?.email || '?';
  const el = h('span', { class: 'sx-av', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px', background: colorFor(user?.id || name) }, title: name, 'aria-label': name }, initials(name));
  if (user?.avatar) avatarUrl(user.avatar).then((u) => { if (u) { el.textContent = ''; el.style.backgroundImage = `url(${u})`; } });
  return el;
}
export const field = (label, attrs = {}) => { const input = h(attrs.tag || 'input', attrs); return [h('label', {}, label, input), input]; };
export const bytes = (n = 0) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
export const ago = (t) => { if (!t) return 'never'; const s = Math.round((Date.now() - new Date(t).getTime()) / 1000); return s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
export const errText = (e) => (e?.name === 'TypeError' ? 'Cannot reach the server. Check the address and your connection.' : e?.message || String(e));
/** only same-app hash targets are allowed as ?next= (no open redirects) */
export const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-./%?=&]*$/.test(n) && !n.startsWith('/auth') ? n : '/');
export function spark(series, color = 'var(--accent,#ff9f0a)') {
  const max = Math.max(1, ...series.map((p) => p.n)), w = 300, hh = 56;
  const pts = series.map((p, i) => `${(i / Math.max(1, series.length - 1)) * w},${hh - 4 - (p.n / max) * (hh - 10)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hh}`); svg.setAttribute('class', 'sx-spark'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img');
  const pl = document.createElementNS(ns, 'polyline'); pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '2'); pl.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(pl); return svg;
}
