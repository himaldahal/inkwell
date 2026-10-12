import { h } from '../core/utils.js';
import { on } from '../core/store.js';
export { h };

const P = {
  plus: 'M12 5v14M5 12h14', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  menu: 'M3 12h18M3 6h18M3 18h18', star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  pin: 'M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z', archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  check: 'M20 6L9 17l-5-5', x: 'M18 6L6 18M6 6l12 12', more: 'M12 12h.01M19 12h.01M5 12h.01',
  chevR: 'M9 18l6-6-6-6', chevD: 'M6 9l6 6 6-6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  sort: 'M3 6h18M6 12h12M10 18h4', sidebar: 'M3 3h18v18H3zM9 3v18',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  cloudoff: 'M22.6 16.9A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3M1 1l22 22',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  select: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  command: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', back: 'M19 12H5M12 19l-7-7 7-7',
  open: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9z', calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  focus: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  flame: 'M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-4-2-7-5-9 0 5-3 7-3 12 0 4 3 8 7 8z',
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  wifioff: 'M1 1l22 22M16.7 11.1A11 11 0 0 1 21 14M5 14a11 11 0 0 1 5-2.9M8.5 17.5a6 6 0 0 1 7 0M12 21h.01',
};
const NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 20) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'more' ? 3 : 1.8);
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.classList.add('ic');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', P[name] || P.info); s.append(p);
  return s;
}
export const iconBtn = (name, label, onclick, extra = {}) =>
  h('button', { class: 'icon-btn ' + (extra.class || ''), type: 'button', 'aria-label': label, title: label, onclick, ...(extra.attrs || {}) }, icon(name, extra.size || 20));

export const overlayRoot = () => document.getElementById('overlay-root');
export const isNarrow = () => matchMedia('(max-width: 699px)').matches;
export const isDesktop = () => matchMedia('(min-width: 1100px)').matches;
export const finePointer = () => matchMedia('(pointer: fine)').matches;

// ---------- toasts ----------
let toastHost;
export function initToasts() {
  toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  document.body.append(toastHost);
  on('toast', showToast);
}
function showToast({ message, type, kind, action, duration }) {
  if (!toastHost) return;
  const t = type || kind || 'info';
  let timer;
  const el = h('div', { class: 'toast ' + t });
  const remove = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.append(h('span', { class: 'toast-msg' }, message));
  if (action) el.append(h('button', { class: 'toast-act', type: 'button', onclick: () => { try { action.onClick?.(); } finally { remove(); } } }, action.label));
  el.append(h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dismiss', onclick: remove }, icon('x', 16)));
  toastHost.append(el);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  timer = setTimeout(remove, duration || (action ? 6000 : 3500));
}

/** drag-to-dismiss for bottom sheets: drag down from the top 56px (or the handle) */
export function dragDismiss(el, close, handleOnly = false) {
  let y0 = null, dy = 0, t0 = 0;
  el.addEventListener('pointerdown', (e) => {
    if (!isNarrow() || e.pointerType === 'mouse') return;
    const r = el.getBoundingClientRect();
    if (e.clientY - r.top > 56 || (handleOnly && e.target.closest('button, input'))) return;
    y0 = e.clientY; dy = 0; t0 = Date.now(); el.classList.add('sheet-dragging'); el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); el.style.transform = `translateY(${dy}px)`; });
  const end = () => {
    if (y0 == null) return; const fast = dy / Math.max(1, Date.now() - t0) > 0.6; y0 = null;
    el.classList.remove('sheet-dragging'); el.classList.add('sheet-drag');
    if (dy > 110 || (fast && dy > 30)) { el.style.transform = 'translateY(110%)'; setTimeout(close, 150); } else el.style.transform = '';
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

// ---------- modal / sheet ----------
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function openModal({ title, body, actions = [], size = 'md', onClose, hideHead = false, className = '' }) {
  const prevFocus = document.activeElement;
  const backdrop = h('div', { class: 'backdrop' });
  const dlg = h('div', { class: `modal ${size} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog', tabindex: '-1' });
  let result; let closed = false; let resolveClosed;
  const closedP = new Promise((r) => { resolveClosed = r; });
  const close = (v) => {
    if (closed) return; closed = true; result = v;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('out');
    setTimeout(() => backdrop.remove(), 160);
    try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    onClose?.(v); resolveClosed(v);
  };
  if (!hideHead) dlg.append(h('div', { class: 'modal-head' }, h('h2', {}, title || ''), iconBtn('x', 'Close', () => close())));
  const bodyEl = h('div', { class: 'modal-body' }, body);
  dlg.append(bodyEl);
  const ctx = { close, el: dlg, bodyEl };
  if (actions.length) {
    dlg.append(h('div', { class: 'modal-foot' }, actions.map((a) => {
      const b = h('button', { class: 'btn ' + (a.kind || ''), type: 'button', 'data-primary': a.kind === 'primary' || a.kind === 'danger' ? '1' : null }, a.label);
      b.addEventListener('click', async () => { const r = a.onClick ? await a.onClick(ctx) : undefined; if (r !== false) close(a.value); });
      a.el = b; return b;
    })));
  }
  function onKey(e) {
    if (backdrop.nextElementSibling) return; // not top-most
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.isComposing) { dlg.querySelector('[data-primary]')?.click(); }
    else if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
  backdrop.append(dlg);
  overlayRoot().append(backdrop);
  dragDismiss(dlg, () => close());
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => { (dlg.querySelector('[autofocus],input,textarea') || dlg).focus({ preventScroll: true }); });
  return { ...ctx, closed: closedP, get result() { return result; } };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false }) {
  return new Promise((res) => {
    const m = openModal({
      title, size: 'sm', body: h('p', { class: 'muted-p' }, message),
      actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true }],
    });
    m.closed.then((v) => res(v === true));
  });
}
export function promptDialog({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save', type = 'text', hint = '' }) {
  return new Promise((res) => {
    let answer = null;
    const input = h('input', { class: 'input', type, value, placeholder, 'aria-label': label || title, autocomplete: 'off' });
    const m = openModal({
      title, size: 'sm', body: [label && h('label', { class: 'field-label' }, label), input, hint && h('p', { class: 'hint' }, hint)],
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: confirmLabel, kind: 'primary', onClick: () => { answer = input.value; } }],
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    m.closed.then(() => res(answer));
  });
}

// ---------- context menu / action sheet ----------
let closeMenuFn = null;
export function openMenu(items, { x = 0, y = 0, anchor, title } = {}) {
  closeMenuFn?.();
  items = items.filter(Boolean);
  const narrow = isNarrow();
  const prevFocus = document.activeElement;
  const backdrop = h('div', { class: 'menu-backdrop' + (narrow ? ' sheet-bd' : '') });
  const menu = h('div', { class: 'menu' + (narrow ? ' sheet' : ''), role: 'menu', 'aria-label': title || 'Actions' });
  if (narrow && title) menu.append(h('div', { class: 'menu-title' }, title));
  let closed = false;
  const close = () => {
    if (closed) return; closed = true; closeMenuFn = null;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('out'); setTimeout(() => backdrop.remove(), 140);
    try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
  };
  for (const it of items) {
    if (it.divider) { menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (it.heading) { menu.append(h('div', { class: 'menu-head' }, it.heading)); continue; }
    const b = h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: it.checked != null ? 'menuitemradio' : 'menuitem', 'aria-checked': it.checked != null ? String(!!it.checked) : null, disabled: it.disabled },
      it.icon ? icon(it.icon, 18) : h('span', { class: 'ic-sp' }),
      h('span', { class: 'menu-label' }, it.label),
      it.checked ? icon('check', 16) : it.hint ? h('kbd', {}, it.hint) : null);
    b.addEventListener('click', () => { close(); setTimeout(() => it.onClick?.(), 0); });
    menu.append(b);
  }
  backdrop.append(menu);
  overlayRoot().append(backdrop);
  if (narrow) dragDismiss(menu, close);
  if (!narrow) {
    const r = anchor?.getBoundingClientRect?.();
    let px = r ? r.right : x, py = r ? r.bottom + 4 : y;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (r) px = px - mw;
    px = Math.max(8, Math.min(px, innerWidth - mw - 8));
    if (py + mh > innerHeight - 8) py = r ? Math.max(8, r.top - mh - 4) : Math.max(8, innerHeight - mh - 8);
    menu.style.left = px + 'px'; menu.style.top = py + 'px';
  }
  const btns = () => [...menu.querySelectorAll('.menu-item:not([disabled])')];
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const b = btns(); const i = b.indexOf(document.activeElement);
      b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length]?.focus();
    } else if (e.key === 'Tab') { e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) { e.preventDefault(); close(); } });
  backdrop.addEventListener('contextmenu', (e) => { if (e.target === backdrop) { e.preventDefault(); close(); } });
  closeMenuFn = close;
  btns()[0]?.focus({ preventScroll: true });
  return close;
}

export const chip = (text, extra = {}) => h('span', { class: 'chip ' + (extra.class || ''), style: extra.style }, text);
export function emptyState({ icon: ic = 'file', title, text, actions = [] }) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, icon(ic, 34)), h('h3', {}, title), text && h('p', {}, text),
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}
export const skeletonGrid = (n = 8) => h('div', { class: 'grid skeleton-grid', 'aria-hidden': 'true' },
  Array.from({ length: n }, () => h('div', { class: 'card sk' }, h('div', { class: 'thumb sk-box' }), h('div', { class: 'sk-line' }), h('div', { class: 'sk-line short' }))));
export const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;
