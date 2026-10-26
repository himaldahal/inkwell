// Template gallery: searchable, grouped by category, with live thumbnails drawn by the editor's own paper renderer.
import { h } from './dom.js';
import { PRESETS, PRESET_CATS } from './templates.js';
import { drawTemplate } from '../editor/templates.js';

const RECENT_KEY = 'ik-recent-presets';
const W = 820, H = 1160;
export const recentPresets = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((id) => PRESETS.some((p) => p.id === id)); } catch { return []; } };
export const rememberPreset = (id) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentPresets().filter((x) => x !== id)].slice(0, 8))); } catch { /* storage unavailable */ } };

/**
 * opts: { paper, selected, onSelect(preset), onOpen(preset) }  (onOpen = double click / Enter on a card)
 * returns { el, setPaper(color), focusSearch() }
 */
export function buildGallery({ paper = null, selected = null, onSelect, onOpen } = {}) {
  let cat = 'All', q = '', sel = selected, pap = paper;
  const search = h('input', { class: 'input tg-search', type: 'search', placeholder: `Search ${PRESETS.length} templates (planner, ledger, SWOT...)`, 'aria-label': 'Search templates', autocomplete: 'off' });
  const chips = h('div', { class: 'tg-chips', role: 'tablist', 'aria-label': 'Template categories' });
  const grid = h('div', { class: 'tg-grid' });
  const empty = h('p', { class: 'tg-empty', hidden: true }, 'No template matches that. Try another word.');
  const el = h('div', { class: 'tg' }, search, chips, grid, empty);

  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); paint(e.target); } }, { root: null, rootMargin: '300px' });
  function paint(cv) {
    const p = PRESETS.find((x) => x.id === cv.dataset.id); if (!p) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = 150, hh = Math.round((w * H) / W);
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    const c = cv.getContext('2d'); c.setTransform((w * dpr) / W, 0, 0, (hh * dpr) / H, 0, 0);
    drawTemplate(c, W, H, p.base, pap || '#ffffff', p.ops || ['planner', 'weekly', 'staff', 'graph'].includes(p.id) ? p.id : null);
  }
  const matches = (p) => (cat === 'All' || (cat === 'Recent' ? recentPresets().includes(p.id) : p.cat === cat)) && (!q || (p.label + ' ' + p.cat + ' ' + p.id).toLowerCase().includes(q));
  function order() {
    const rec = recentPresets();
    return cat === 'Recent' ? rec.map((id) => PRESETS.find((p) => p.id === id)).filter(Boolean) : PRESETS;
  }
  function render() {
    io.disconnect();
    const list = order().filter(matches);
    grid.replaceChildren(...list.map((p) => {
      const cv = h('canvas', { class: 'tg-cv', 'data-id': p.id });
      const b = h('button', { type: 'button', class: 'tg-card' + (sel === p.id ? ' sel' : ''), 'data-id': p.id, 'aria-pressed': String(sel === p.id), title: p.label + ' · ' + p.cat }, cv, h('span', { class: 'tg-name' }, p.label), h('span', { class: 'tg-cat' }, p.cat));
      b.addEventListener('click', () => { pick(p); });
      b.addEventListener('dblclick', () => { pick(p); onOpen?.(p); });
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); pick(p); onOpen?.(p); } });
      io.observe(cv);
      return b;
    }));
    empty.hidden = list.length > 0;
    return list;
  }
  function pick(p) {
    sel = p.id; onSelect?.(p);
    for (const b of grid.children) { const on = b.dataset.id === sel; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', String(on)); }
  }
  function drawChips() {
    const names = ['All', ...(recentPresets().length ? ['Recent'] : []), ...PRESET_CATS];
    chips.replaceChildren(...names.map((n) => {
      const b = h('button', { type: 'button', class: 'tg-chip' + (cat === n ? ' on' : ''), role: 'tab', 'aria-selected': String(cat === n) }, n);
      b.addEventListener('click', () => { cat = n; drawChips(); render(); });
      return b;
    }));
  }
  search.addEventListener('input', () => {
    q = search.value.trim().toLowerCase();
    const list = render();
    if (q && list[0]) pick(list[0]); // typing selects the best match so Enter creates it straight away
  });
  drawChips(); render();
  return {
    el, focusSearch: () => search.focus(),
    setPaper(c) { pap = c; for (const cv of grid.querySelectorAll('canvas')) paint(cv); },
    select(id) { sel = id; for (const b of grid.children) { const on = b.dataset.id === id; b.classList.toggle('sel', on); } },
  };
}
