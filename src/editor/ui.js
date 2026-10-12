// Small shared UI helpers: buttons, popovers, menus, local prefs.
import { h } from '../core/utils.js';
import { icon } from './icons.js';

export const pref = {
  get(k, d) { try { const v = localStorage.getItem('inkwell.editor.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('inkwell.editor.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/** icon button; keeps editor focus (needed for contenteditable formatting) */
export function ibtn(ic, label, onClick, cls = '') {
  const b = h('button', { class: 'ik-btn ' + cls, type: 'button', title: label, 'aria-label': label });
  if (ic) b.append(typeof ic === 'string' ? icon(ic, 20) : ic);
  b.addEventListener('mousedown', (e) => e.preventDefault());
  if (onClick) b.addEventListener('click', (e) => onClick(e, b));
  return b;
}

let openPop = null;
export function closePopover() { if (openPop) { openPop.close(); openPop = null; } }
/** Show `content` in a floating panel anchored to `anchor`. Returns {close, el}. */
export function popover(anchor, content, { align = 'start', cls = '', onClose } = {}) {
  closePopover();
  const root = anchor.closest('.ik-root') || document.body;
  const el = h('div', { class: 'ik-pop ' + cls, role: 'dialog', 'data-ik-ui': '' }, content);
  root.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const w = el.offsetWidth, hh = el.offsetHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(rr.left + 6, Math.min(left, rr.right - w - 6));
    let top = r.bottom + 6;
    if (top + hh > rr.bottom - 6) top = Math.max(rr.top + 6, r.top - hh - 6);
    el.style.left = left - rr.left + 'px'; el.style.top = top - rr.top + 'px';
  };
  place();
  const down = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) api.close(); };
  const key = (e) => { if (e.key === 'Escape') api.close(); };
  setTimeout(() => { document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key); }, 0);
  const api = {
    el, place,
    close() {
      document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key);
      el.remove(); if (openPop === api) openPop = null; onClose?.();
    },
  };
  openPop = api;
  return api;
}
/** menu of {label, icon, run, danger, disabled} */
export function menu(anchor, items, opts) {
  const box = h('div', { class: 'ik-menu' });
  let pop;
  for (const it of items) {
    if (it === '-') { box.append(h('div', { class: 'ik-sep' })); continue; }
    if (it.title) { box.append(h('div', { class: 'ik-menu-title' }, it.title)); continue; }
    const b = h('button', { type: 'button', class: 'ik-menu-item' + (it.danger ? ' danger' : '') + (it.on ? ' on' : ''), disabled: it.disabled },
      it.icon ? icon(it.icon, 18) : h('span', { class: 'ik-ic-sp' }), h('span', {}, it.label));
    b.addEventListener('click', () => { if (!it.keepOpen) pop.close(); it.run?.(b); });
    box.append(b);
  }
  pop = popover(anchor, box, opts);
  return pop;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
