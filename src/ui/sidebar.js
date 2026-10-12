import { h, icon, iconBtn, openMenu, plural } from './dom.js';
import { getAll } from '../core/db.js';
import { on, toast } from '../core/store.js';
import { navigate, current, href } from '../core/router.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { debounce } from '../core/utils.js';
import * as A from './actions.js';
import { SMART } from './templates.js';
import { newNoteDialog, notebookDialog, deleteNotebookFlow, movePicker, quickNote } from './dialogs.js';
import { openPalette } from './palette.js';
import { createInstallButton } from './install.js';
import { isStaff, hasUi } from './config.js';

const DT = 'application/x-inkwell';
export function readDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData(DT) || 'null'); } catch { return null; }
}

export function createSidebar() {
  const el = h('aside', { class: 'sidebar', 'aria-label': 'Library navigation' });
  let nbs = [], notes = [], trashedNbs = 0;

  const count = (fn) => notes.filter(fn).length;
  const live = (n) => !n.trashedAt;
  function navItem({ path, label, ic, n, key, drop }) {
    const a = h('a', { class: 'nav-item', href: href(path), 'data-key': key || path, draggable: 'false' }, icon(ic, 18), h('span', { class: 'grow' }, label), n ? h('span', { class: 'count' }, n) : null);
    if (drop) enableDrop(a, drop);
    return a;
  }
  function enableDrop(node, onDrop) {
    node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(DT)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; node.classList.add('drop'); } });
    node.addEventListener('dragleave', () => node.classList.remove('drop'));
    node.addEventListener('drop', (e) => { node.classList.remove('drop'); const d = readDrag(e); if (d) { e.preventDefault(); e.stopPropagation(); onDrop(d); } });
  }
  async function dropOnNotebook(id, d) {
    if (d.kind === 'notes') await A.moveNotes(d.ids, id);
    else if (d.kind === 'notebook' && d.id !== id) {
      if (id && A.descendantIds(nbs, d.id).has(id)) { toast("Can't move a notebook inside itself", { type: 'error' }); return; }
      await A.updateNotebook(d.id, { parentId: id });
    }
  }
  function nbMenu(nb, anchor, e) {
    openMenu([
      { label: 'New note here', icon: 'plus', onClick: () => newNoteDialog({ notebookId: nb.id }) },
      { label: 'New sub-notebook', icon: 'folder', onClick: () => notebookDialog({ parentId: nb.id }) },
      { divider: true },
      { label: 'Edit (name, color, icon)', icon: 'edit', onClick: () => notebookDialog({ notebook: nb }) },
      { label: 'Move to...', icon: 'move', onClick: async () => { const ban = A.descendantIds(nbs, nb.id); const t = await movePicker({ title: 'Move notebook to', current: nb.parentId }); if (t === undefined) return; if (t && ban.has(t)) return toast("Can't move a notebook inside itself", { type: 'error' }); A.updateNotebook(nb.id, { parentId: t }); } },
      { label: 'Export notebook as PDFs (ZIP)', icon: 'download', onClick: () => A.exportNotebookPdfs(nb.id) },
      { divider: true },
      { label: 'Delete notebook', icon: 'trash', danger: true, onClick: () => deleteNotebookFlow(nb) },
    ], e ? { x: e.clientX, y: e.clientY } : { anchor });
  }
  function nbNode(nb, depth, counts, expanded) {
    const kids = nbs.filter((n) => (n.parentId || null) === nb.id);
    const open = expanded[nb.id];
    const row = h('div', { class: 'nav-item nb', role: 'treeitem', 'aria-expanded': kids.length ? String(!!open) : null, 'aria-level': depth + 1, 'data-key': '/notebook/' + nb.id, style: { paddingLeft: 8 + depth * 16 + 'px' }, draggable: 'true' },
      kids.length ? h('button', { class: 'twisty' + (open ? ' open' : ''), type: 'button', 'aria-label': (open ? 'Collapse ' : 'Expand ') + nb.name, onclick: (e) => { e.preventDefault(); e.stopPropagation(); updateSettings({ expanded: { ...getSettings().expanded, [nb.id]: !open } }); render(); } }, icon('chevR', 14)) : h('span', { class: 'twisty-sp' }),
      h('a', { class: 'nb-link', href: href('/notebook/' + encodeURIComponent(nb.id)), draggable: 'false' }, h('span', { class: 'nb-ic', style: { background: nb.color + '26', color: nb.color } }, nb.icon || '📓'), h('span', { class: 'grow ellipsis' }, nb.name), counts.get(nb.id) ? h('span', { class: 'count' }, counts.get(nb.id)) : null),
      h('button', { class: 'row-more', type: 'button', 'aria-label': 'Notebook actions for ' + nb.name, onclick: (e) => { e.preventDefault(); e.stopPropagation(); nbMenu(nb, e.currentTarget); } }, icon('more', 16)));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); nbMenu(nb, null, e); });
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData(DT, JSON.stringify({ kind: 'notebook', id: nb.id })); e.dataTransfer.effectAllowed = 'move'; });
    enableDrop(row, (d) => dropOnNotebook(nb.id, d));
    row.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' && kids.length && !open) updateSettings({ expanded: { ...getSettings().expanded, [nb.id]: true } }).then(render); if (e.key === 'ArrowLeft' && open) updateSettings({ expanded: { ...getSettings().expanded, [nb.id]: false } }).then(render); });
    const frag = [row];
    if (kids.length && open) frag.push(h('div', { role: 'group' }, kids.flatMap((k) => nbNode(k, depth + 1, counts, expanded))));
    return frag;
  }

  async function load() { [nbs, notes, trashedNbs] = [await A.getNotebooks(), await getAll('notes'), (await A.getTrashedNotebooks()).filter((n) => n.trashedBy === n.id || !n.trashedBy).length]; render(); }
  function render() {
    const s = getSettings();
    const expanded = { ...s.expanded };
    const r = current();
    if (r.name === 'notebook') { let c = nbs.find((n) => n.id === r.params.id); while (c?.parentId) { expanded[c.parentId] = true; c = nbs.find((n) => n.id === c.parentId); } }
    const live_ = notes.filter(live);
    const counts = new Map();
    for (const n of live_.filter((x) => !x.archived)) { let c = nbs.find((b) => b.id === n.notebookId); let g = 0; while (c && g++ < 20) { counts.set(c.id, (counts.get(c.id) || 0) + 1); c = nbs.find((b) => b.id === c.parentId); } }
    const tagMap = new Map();
    for (const n of live_.filter((x) => !x.archived)) for (const t of n.tags || []) tagMap.set(t, (tagMap.get(t) || 0) + 1);
    const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const active = live_.filter((n) => !n.archived);

    el.replaceChildren(
      h('div', { class: 'sb-head' },
        h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('edit', 16)), 'Inkwell'),
        iconBtn('sidebar', 'Hide sidebar', () => updateSettings({ sidebarCollapsed: true }).then(applyCollapsed), { class: 'hide-phone' })),
      h('div', { class: 'sb-actions' },
        h('button', { class: 'btn primary block', type: 'button', onclick: () => newNoteDialog({ notebookId: current().name === 'notebook' ? current().params.id : null }) }, icon('plus', 18), 'New note'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Quick note', title: 'Quick note (no dialog)', onclick: () => quickNote() }, icon('zap', 18))),
      h('button', { class: 'search-trigger', type: 'button', onclick: () => openPalette() }, icon('search', 16), h('span', { class: 'grow' }, 'Search or jump to...'), h('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K')),
      h('nav', { class: 'sb-scroll', 'aria-label': 'Library' },
        h('div', { class: 'sb-sec' },
          h('div', { class: 'sb-title' }, h('span', {}, 'Library')),
          navItem({ path: '/', key: '/', label: 'All notes', ic: 'file', n: active.length || '', drop: (d) => d.kind === 'notes' && A.moveNotes(d.ids, null) }),
          navItem({ path: '/favorites', label: 'Favorites', ic: 'star', n: active.filter((n) => n.favorite).length || '' }),
          navItem({ path: '/recent', label: 'Recent', ic: 'clock' }),
          navItem({ path: '/shared', label: 'Shared', ic: 'link', n: live_.filter((n) => A.shareInfo(n).incoming).length || '' }),
          (live_.some((n) => A.shareInfo(n).public) ? navItem({ path: '/public', label: 'Public links', ic: 'open', n: live_.filter((n) => A.shareInfo(n).public).length }) : null)),
        h('div', { class: 'sb-sec' },
          h('div', { class: 'sb-title' }, h('span', {}, 'Subjects'), iconBtn('plus', 'New subject', () => notebookDialog(), { size: 16, class: 'sm' })),
          h('div', { role: 'tree', 'aria-label': 'Notebooks', class: 'tree' }, nbs.length ? nbs.filter((n) => !n.parentId || !nbs.some((p) => p.id === n.parentId)).flatMap((n) => nbNode(n, 0, counts, expanded))
            : h('button', { class: 'sb-empty', type: 'button', onclick: () => notebookDialog() }, icon('folder', 16), 'Create your first subject'))),
        h('div', { class: 'sb-sec' },
          h('div', { class: 'sb-title' }, h('span', {}, 'Smart filters')),
          SMART.map((f) => navItem({ path: '/smart/' + f.id, label: f.label, ic: f.icon, n: active.filter(f.test).length || '' }))),
        tags.length ? h('div', { class: 'sb-sec' }, h('div', { class: 'sb-title' }, h('span', {}, 'Tags')), tags.map(([t, c]) => navItem({ path: '/tag/' + encodeURIComponent(t), label: t, ic: 'tag', n: c }))) : null),
      h('div', { class: 'sb-sec sb-bottom' }, navItem({ path: '/archive', label: 'Archive', ic: 'archive', n: live_.filter((n) => n.archived).length || '' }), navItem({ path: '/trash', label: 'Trash', ic: 'trash', n: (notes.filter((n) => n.trashedAt).length + trashedNbs) || '' })),
      h('div', { class: 'sb-foot' }, createInstallButton({ compact: true }), isStaff() && hasUi('admin') ? h('a', { class: 'nav-item', href: '#/admin', 'data-key': '/admin' }, icon('lock', 18), h('span', { class: 'grow' }, 'Admin')) : null,
      h('a', { class: 'nav-item', href: '#/settings', 'data-key': '/settings' }, icon('settings', 18), h('span', { class: 'grow' }, 'Settings'))));
    mark();
  }
  function mark() {
    const r = current();
    let key = r.path.split('?')[0];
    if (r.name === 'notebook') key = '/notebook/' + r.params.id;
    el.querySelectorAll('[data-key]').forEach((n) => {
      const k = n.getAttribute('data-key');
      const on_ = decodeURIComponent(k) === decodeURIComponent(key) || (k === '/' && (r.name === 'all' || r.name === 'search'));
      n.classList.toggle('active', on_);
      if (on_) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
  }
  const applyCollapsed = () => document.documentElement.classList.toggle('sb-collapsed', !!getSettings().sidebarCollapsed);
  const reload = debounce(load, 120);
  on('account:changed', render);
  on('notes:changed', reload); on('notebooks:changed', reload);
  on('route:changed', () => { if (current().name === 'notebook') render(); else mark(); });
  load();
  applyCollapsed();
  return { el, reload: load, applyCollapsed };
}
