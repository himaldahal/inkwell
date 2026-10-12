import { h, icon, openModal, plural } from './dom.js';
import { getAll } from '../core/db.js';
import { navigate, noteHref } from '../core/router.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { fmtDate } from '../core/utils.js';
import { isNoteLocked } from './lock.js';
import * as A from './actions.js';

/** subsequence fuzzy score; higher is better, -1 = no match */
export function fuzzy(q, s) {
  q = q.toLowerCase(); s = (s || '').toLowerCase();
  if (!q) return 0;
  const idx = s.indexOf(q);
  if (idx >= 0) return 100 - idx + (idx === 0 || s[idx - 1] === ' ' ? 20 : 0) - (s.length - q.length) * 0.1;
  let qi = 0, score = 0, prev = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { score += prev === i - 1 ? 5 : 1; prev = i; qi++; }
  }
  return qi === q.length ? score : -1;
}

let commandsProvider = () => [];
export const setCommands = (fn) => { commandsProvider = fn; };

export async function openPalette(initial = '') {
  const all = (await getAll('notes')).filter((n) => !n.trashedAt);
  const nbs = await A.getNotebooks();
  const tags = [...new Set(all.flatMap((n) => n.tags || []))];
  const input = h('input', { class: 'pal-in', type: 'text', placeholder: 'Search notes, notebooks, tags or type a command', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-label': 'Command palette', autocomplete: 'off', value: initial });
  const listEl = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox' });
  let results = [], sel = 0;
  const m = openModal({ title: 'Command palette', hideHead: true, size: 'pal', body: [h('div', { class: 'pal-top' }, icon('search', 18), input, h('kbd', {}, 'Esc')), listEl] });
  const run = (r) => { m.close(); setTimeout(() => r.run(), 0); };
  function compute() {
    const q = input.value.trim().replace(/^>/, '');
    const cmdOnly = input.value.trim().startsWith('>');
    const out = [];
    const cmds = commandsProvider().map((c) => ({ ...c, kind: 'Command', s: fuzzy(q, c.label) })).filter((c) => c.s >= 0);
    if (!q) { out.push(...cmds.slice(0, 6)); }
    else out.push(...cmds.sort((a, b) => b.s - a.s).slice(0, cmdOnly ? 12 : 4));
    if (!cmdOnly) {
      const ns = all.map((n) => ({ n, s: Math.max(fuzzy(q, n.title || 'Untitled') * 1.5, isNoteLocked(n) ? -1 : fuzzy(q, n.textIndex || '') - 20, fuzzy(q, (n.tags || []).join(' ')) - 10) }))
        .filter((x) => !q || x.s >= 0).sort((a, b) => (q ? b.s - a.s : b.n.updatedAt - a.n.updatedAt)).slice(0, q ? 8 : 5);
      out.push(...ns.map(({ n }) => ({ kind: 'Note', ic: n.lock ? 'lock' : 'file', label: n.title || 'Untitled', sub: fmtDate(n.updatedAt), run: () => navigate('/note/' + encodeURIComponent(n.id)) })));
      if (q) {
        out.push(...nbs.map((b) => ({ b, s: fuzzy(q, b.name) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 3).map(({ b }) => ({ kind: 'Notebook', ic: 'folder', label: A.notebookPath(nbs, b.id), run: () => navigate('/notebook/' + encodeURIComponent(b.id)) })));
        out.push(...tags.map((t) => ({ t, s: fuzzy(q.replace(/^#/, ''), t) })).filter((x) => x.s >= 0).slice(0, 3).map(({ t }) => ({ kind: 'Tag', ic: 'tag', label: '#' + t, run: () => navigate('/tag/' + encodeURIComponent(t)) })));
        out.push({ kind: 'Search', ic: 'search', label: `Search all notes for "${q}"`, run: () => { navigate('/search'); setTimeout(() => document.querySelector('.search-in')?.focus(), 80); } });
      }
    }
    results = out; sel = 0; paint();
  }
  function paint() {
    listEl.replaceChildren();
    if (!results.length) { listEl.append(h('div', { class: 'pal-empty' }, 'No results')); return; }
    let lastKind = '';
    results.forEach((r, i) => {
      if (r.kind !== lastKind) { listEl.append(h('div', { class: 'pal-group' }, r.kind === 'Command' ? 'Commands' : r.kind + 's')); lastKind = r.kind; }
      listEl.append(h('div', { class: 'pal-item' + (i === sel ? ' sel' : ''), role: 'option', id: 'pal-' + i, 'aria-selected': String(i === sel), onclick: () => run(r), onmousemove: () => { if (sel !== i) { sel = i; mark(); } } },
        icon(r.ic || 'command', 18), h('span', { class: 'grow ellipsis' }, r.label), r.sub ? h('small', {}, r.sub) : null, r.hint ? h('kbd', {}, r.hint) : null));
    });
  }
  function mark() {
    listEl.querySelectorAll('.pal-item').forEach((n, i) => { n.classList.toggle('sel', i === sel); n.setAttribute('aria-selected', String(i === sel)); if (i === sel) n.scrollIntoView({ block: 'nearest' }); });
    input.setAttribute('aria-activedescendant', 'pal-' + sel);
  }
  input.addEventListener('input', compute);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (results[sel]) run(results[sel]); }
  });
  compute();
  setTimeout(() => input.focus(), 20);
}
