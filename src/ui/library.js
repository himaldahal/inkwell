import { h, icon, iconBtn, openMenu, emptyState, skeletonGrid, plural, isDesktop, finePointer, isNarrow } from './dom.js';
import { listNotes } from '../core/db.js';
import { on, toast } from '../core/store.js';
import { navigate, noteHref, current, href } from '../core/router.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { debounce } from '../core/utils.js';
import { fmtDate } from './fmt.js';
import * as A from './actions.js';
import { SMART, PRESETS } from './templates.js';
import { paperEl, newNoteDialog, noteMenuItems, movePicker, tagDialog, quickNote } from './dialogs.js';
import { createSyncPill } from './syncStatus.js';
import { isNoteLocked, requireUnlock } from './lock.js';
import { createPreview } from './preview.js';
import { isEnabled } from '../core/modules.js';
import { confirmDialog } from './dom.js';

const DT = 'application/x-inkwell';
const CHUNK = 36;
const TIPS = [
  ['Tap + to start a note', 'Pick a page style, or jump in with a ready-made template.'],
  ['Organize with notebooks', 'Drag a note onto a notebook in the sidebar, or use the note menu to move it.'],
  ['Press Ctrl/Cmd + K', 'Search every note and run any command from one place.'],
  ['Link notes together', 'Type [[Note title]] inside a note to link it. Backlinks show up here in the preview.'],
  ['Drop in a PDF', 'Drag a PDF or image onto the library to annotate it as a note.'],
];

export function createLibrary() {
  const el = h('section', { class: 'lib-wrap' });
  const preview = createPreview({ onOpen: (id) => openNote(id) });
  let route = current(), nbs = [], notes = [], trashNbs = [], query = '', tok = 0, previewId = null, loaded = false;
  const selected = new Set(); let selecting = false;
  const cache = new Map();
  let shown = 0, items = [];

  const searchIn = h('input', { class: 'search-in', type: 'search', placeholder: 'Search notes, text and tags', 'aria-label': 'Search notes', autocomplete: 'off' });
  const titleEl = h('h1', { class: 'lib-title' });
  const subEl = h('p', { class: 'lib-sub' });
  const viewBtn = h('button', { class: 'icon-btn', type: 'button', onclick: () => updateSettings({ view: getSettings().view === 'grid' ? 'list' : 'grid' }).then(paintHead) });
  const head = h('header', { class: 'lib-head' });
  const selbar = h('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Selection actions', hidden: true });
  const top = h('div', { class: 'lib-top' });
  const body = h('div', { class: 'lib-body', tabindex: '-1' });
  const gridEl = h('div', { class: 'grid', role: 'list' });
  const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
  const fab = h('div', { class: 'fab-group' },
    h('button', { class: 'fab mini', type: 'button', 'aria-label': 'Daily note', title: 'Daily note', onclick: async () => { const n = await A.openDailyNote(); navigate('/note/' + encodeURIComponent(n.id)); } }, icon('calendar', 20)),
    h('button', { class: 'fab', type: 'button', 'aria-label': 'New note', onclick: (e) => newMenu(e.currentTarget) }, icon('plus', 24), h('span', { class: 'fab-label' }, 'New note')));
  const list = h('div', { class: 'lib' }, head, selbar, top, body, fab);
  body.append(gridEl, sentinel);
  el.append(list, preview.el);

  const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) more(); }, { root: body, rootMargin: '800px 0px' });
  io.observe(sentinel);

  const curNb = () => (route.name === 'notebook' ? route.params.id : null);
  function newMenu(anchor) {
    openMenu([
      { label: 'Note', icon: 'file', onClick: () => newNoteDialog({ notebookId: curNb() }) },
      { label: 'Subject (notebook)', icon: 'folder', onClick: () => import('./dialogs.js').then((m) => m.notebookDialog({ parentId: curNb() })) },
      isEnabled('pdf') && { label: 'Import PDF', icon: 'upload', onClick: importPdf },
      { label: 'Quick note', icon: 'zap', onClick: () => quickNote({ notebookId: curNb() }) },
    ], { anchor, title: 'Create' });
  }
  function importPdf() {
    const inp = h('input', { type: 'file', accept: 'application/pdf,.pdf,image/*', multiple: true });
    inp.addEventListener('change', async () => {
      if (!inp.files.length) return;
      toast('Importing...');
      try {
        const m = await import('../features/import.js');
        const { ids, failed } = await m.importFiles(inp.files);
        if (failed.length) toast('Some files could not be imported', { type: 'error' });
        if (ids.length === 1) navigate('/note/' + encodeURIComponent(ids[0]));
      } catch (e) { toast('Import failed', { type: 'error' }); }
    });
    inp.click();
  }
  // live presence
  const presence = new Map();
  const paintPresence = () => gridEl.querySelectorAll('.card').forEach((c) => {
    const n = presence.get(c.dataset.id) || 0; let b = c.querySelector('.live-badge');
    if (n && !b) { b = h('span', { class: 'live-badge', title: 'Collaborators are editing now' }, h('i', {}), 'Live'); c.querySelector('.thumb')?.append(b); }
    else if (!n && b) b.remove();
  });
  on('presence:update', (d) => { if (!d?.noteId || !isEnabled('collab')) return; const c = (d.users || []).length; if (c) presence.set(d.noteId, c); else presence.delete(d.noteId); paintPresence(); });

  // ----- header -----
  const titleFor = () => {
    const r = route;
    if (query) return 'Search';
    switch (r.name) {
      case 'favorites': return 'Favorites'; case 'shared': return 'Shared with me'; case 'public': return 'Public links'; case 'recent': return 'Recent'; case 'archive': return 'Archive'; case 'trash': return 'Trash';
      case 'search': return 'Search'; case 'tag': return '#' + r.params.tag;
      case 'smart': return SMART.find((s) => s.id === r.params.id)?.label || 'Smart filter';
      case 'notebook': { const n = nbs.find((x) => x.id === r.params.id); return n ? n.name : 'Notebook'; }
      default: return 'All notes';
    }
  };
  function paintHead() {
    const s = getSettings();
    viewBtn.replaceChildren(icon(s.view === 'grid' ? 'list' : 'grid', 20));
    viewBtn.setAttribute('aria-label', s.view === 'grid' ? 'Switch to list view' : 'Switch to grid view');
    viewBtn.title = viewBtn.getAttribute('aria-label');
    titleEl.textContent = titleFor();
    const crumbs = route.name === 'notebook' && !query ? A.notebookPath(nbs, route.params.id) : '';
    subEl.textContent = query ? plural(notes.length, 'result') : (crumbs && crumbs !== titleFor() ? crumbs + ' - ' : '') + plural(notes.length, 'note');
    head.replaceChildren(
      h('button', { class: 'icon-btn sb-toggle', type: 'button', 'aria-label': 'Show sidebar', title: 'Show sidebar', onclick: () => { updateSettings({ sidebarCollapsed: false }); document.documentElement.classList.remove('sb-collapsed'); } }, icon('sidebar', 20)),
      h('div', { class: 'lib-titles' }, titleEl, subEl),
      h('div', { class: 'search-box' }, icon('search', 16), searchIn),
      h('div', { class: 'head-actions' },
        createSyncPill(), viewBtn,
        iconBtn('sort', 'Sort and group', (e) => sortMenu(e.currentTarget)),
        iconBtn('select', 'Select notes', () => setSelecting(!selecting)),
        h('button', { class: 'btn primary new-btn', type: 'button', 'aria-haspopup': 'menu', onclick: (e) => newMenu(e.currentTarget) }, icon('plus', 18), 'New')));
    fab.hidden = route.name === 'trash' || route.name === 'archive';
  }
  searchIn.addEventListener('input', debounce(() => { query = searchIn.value.trim(); refresh(); }, 120));
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchIn.value = ''; query = ''; searchIn.blur(); refresh(); } if (e.key === 'Enter') gridEl.querySelector('.card')?.focus(); });

  function sortMenu(anchor) {
    const s = getSettings();
    const set = (p) => () => updateSettings(p).then(refresh);
    openMenu([
      { heading: 'Sort by' },
      ...[['updated', 'Date modified'], ['created', 'Date created'], ['title', 'Title']].map(([k, l]) => ({ label: l, checked: s.sort === k, onClick: set({ sort: k, sortDir: k === 'title' ? 'asc' : 'desc' }) })),
      { label: s.sortDir === 'desc' ? 'Descending' : 'Ascending', icon: 'sort', onClick: set({ sortDir: s.sortDir === 'desc' ? 'asc' : 'desc' }) },
      { divider: true }, { heading: 'Group by' },
      ...[['none', 'No grouping'], ['date', 'Date'], ['notebook', 'Notebook']].map(([k, l]) => ({ label: l, checked: s.groupBy === k, onClick: set({ groupBy: k }) })),
    ], { anchor, title: 'Sort and group' });
  }

  // ----- data -----
  async function fetchNotes() {
    nbs = await A.getNotebooks();
    if (query) {
      const [a, b] = await Promise.all([listNotes({ search: query, view: 'all' }), listNotes({ search: query, view: 'archive' })]);
      const q = query.toLowerCase();
      return [...a, ...b].filter((n) => !n.lock || (n.title || '').toLowerCase().includes(q));
    }
    return A.loadView(route, nbs);
  }
  function sorted(arr) {
    const s = getSettings(); const dir = s.sortDir === 'asc' ? 1 : -1;
    const key = route.name === 'trash' ? 'trashedAt' : s.sort;
    const cmp = key === 'title' ? (a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base' }) * (s.sortDir === 'desc' ? -1 : 1) : (a, b) => ((a[key] || 0) - (b[key] || 0)) * dir;
    let out = [...arr].sort(cmp);
    if (route.name === 'recent' && !query) out = [...arr].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
    return out;
  }
  function buildItems(arr) {
    const s = getSettings(); const out = [];
    const canPin = !query && !['trash', 'recent'].includes(route.name);
    const pinned = canPin ? arr.filter((n) => n.pinned) : [];
    const rest = canPin ? arr.filter((n) => !n.pinned) : arr;
    if (pinned.length) { out.push({ head: 'Pinned', icon: 'pin' }); pinned.forEach((n) => out.push({ note: n })); }
    if (s.groupBy === 'date' && !query) {
      const now = new Date(); const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const bucket = (t) => (t >= sod ? 'Today' : t >= sod - 864e5 ? 'Yesterday' : t >= sod - 6 * 864e5 ? 'This week' : t >= sod - 29 * 864e5 ? 'This month' : 'Earlier');
      let last = null;
      for (const n of rest) { const b = bucket(s.sort === 'created' ? n.createdAt : n.updatedAt); if (b !== last) { out.push({ head: b }); last = b; } out.push({ note: n }); }
    } else if (s.groupBy === 'notebook' && !query) {
      const groups = new Map();
      for (const n of rest) { const k = n.notebookId || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
      for (const k of [...groups.keys()].sort((a, b) => (a ? A.notebookPath(nbs, a) : '~').localeCompare(b ? A.notebookPath(nbs, b) : '~'))) {
        out.push({ head: k ? A.notebookPath(nbs, k) || 'Notebook' : 'No notebook' });
        groups.get(k).forEach((n) => out.push({ note: n }));
      }
    } else {
      if (pinned.length && rest.length) out.push({ head: 'Notes' });
      rest.forEach((n) => out.push({ note: n }));
    }
    return out;
  }
  const refresh = async () => {
    const my = ++tok;
    let raw;
    try { raw = await fetchNotes(); } catch (e) { console.error(e); raw = []; }
    if (my !== tok) return;
    notes = raw; loaded = true;
    trashNbs = route.name === 'trash' && !query ? (await A.getTrashedNotebooks()).filter((n) => !n.trashedBy || n.trashedBy === n.id) : [];
    for (const id of [...selected]) if (!notes.some((n) => n.id === id)) selected.delete(id);
    items = buildItems(sorted(notes));
    shown = 0; gridEl.replaceChildren();
    paintHead(); paintTop(); paintSel();
    gridEl.classList.toggle('list', getSettings().view === 'list');
    gridEl.classList.toggle('selecting', selecting);
    body.querySelector('.empty')?.remove();
    if (!notes.length) { gridEl.hidden = true; if (trashNbs.length) { /* notebooks listed above */ } else body.append(emptyFor()); }
    else { gridEl.hidden = false; more(); }
    if (isDesktop() && finePointer()) { if (!notes.some((n) => n.id === previewId)) previewId = null; preview.show(notes.find((n) => n.id === previewId) || null); markPreview(); }
  };
  const refreshSoon = debounce(refresh, 30);

  // ----- rendering -----
  function more() {
    const end = Math.min(items.length, shown + CHUNK);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) {
      const it = items[i];
      frag.append(it.head ? h('h2', { class: 'group-h' }, it.icon ? icon(it.icon, 14) : null, it.head) : cardFor(it.note));
    }
    shown = end; gridEl.append(frag); paintPresence();
  }
  function cardFor(n) {
    const sig = [n.updatedAt, n.pinned, n.favorite, n.archived, n.trashedAt, n.notebookId, (n.tags || []).join(), getSettings().view, !!n.lock, isNoteLocked(n), query, JSON.stringify(A.shareInfo(n))].join('|');
    const c = cache.get(n.id);
    let el_ = c && c.sig === sig ? c.el : null;
    if (!el_) { el_ = buildCard(n); cache.set(n.id, { sig, el: el_ }); }
    el_.classList.toggle('sel', selected.has(n.id));
    el_.setAttribute('aria-selected', String(selected.has(n.id)));
    return el_;
  }
  function snippet(n) {
    if (!query || isNoteLocked(n)) return null;
    const t = n.textIndex || ''; const i = t.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return null;
    const s = Math.max(0, i - 30);
    return h('p', { class: 'snippet' }, (s ? '...' : '') + t.slice(s, i), h('mark', {}, t.slice(i, i + query.length)), t.slice(i + query.length, i + query.length + 60));
  }
  function buildCard(n) {
    const locked = isNoteLocked(n);
    const nb = n.notebookId ? nbs.find((b) => b.id === n.notebookId) : null;
    const thumb = h('div', { class: 'thumb' + (locked ? ' locked' : '') });
    if (n.preview && !locked) thumb.append(h('img', { src: n.preview, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
    else if (n.preview && locked) thumb.append(h('img', { src: n.preview, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', class: 'blur' }));
    else { thumb.append(paperEl(n.template, n.paperColor)); if (n.textIndex && !locked) thumb.append(h('div', { class: 'snip-prev' }, n.textIndex.slice(0, 220))); }
    if (locked) thumb.append(h('span', { class: 'lock-badge' }, icon('lock', 20)));
    thumb.append(h('span', { class: 'check', 'aria-hidden': 'true' }, icon('check', 14)));
    const si = A.shareInfo(n);
    const sb = (ic, t) => h('span', { class: 'sbadge', title: t, 'aria-label': t }, icon(ic, 12));
    const badges = h('span', { class: 'badges' }, n.pinned ? icon('pin', 13) : null, n.favorite ? icon('star', 13) : null, n.lock && !locked ? icon('unlock', 13) : null);
    const shareRow = (si.incoming || si.outgoing || si.public) ? h('div', { class: 'share-badges' },
      si.incoming ? h('span', { class: 'sb in', title: 'Shared by ' + A.ownerLabel(n) }, icon('link', 11), 'From ' + A.ownerLabel(n)) : null,
      si.outgoing && !si.incoming ? h('span', { class: 'sb', title: 'You shared this note' }, icon('link', 11), 'Shared') : null,
      si.public ? h('span', { class: 'sb pub', title: 'Public link' }, icon('open', 11), 'Public') : null,
      si.canEdit ? h('span', { class: 'sb' }, icon('edit', 11), 'Can edit') : null, si.viewOnly ? h('span', { class: 'sb' }, 'View only') : null,
      si.protectedLink ? h('span', { class: 'sb', title: 'Password protected' }, icon('lock', 11)) : null) : null;
    const left = n.trashedAt ? h('span', { class: 'days-badge' + (A.trashDaysLeft(n) <= 3 ? ' soon' : '') }, A.trashDaysLeft(n) + 'd') : null;
    if (left) thumb.append(left);
    const meta = n.trashedAt ? `${A.trashDaysLeft(n)} days left` : (n.archived ? 'Archived - ' : '') + fmtDate(n.updatedAt) + (nb && route.name !== 'notebook' ? ' - ' + nb.name : '');
    const card = h('article', { class: 'card', role: 'listitem', tabindex: '0', draggable: 'true', 'data-id': n.id, 'aria-label': (n.title || 'Untitled') + ', ' + meta },
      thumb,
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, h('span', { class: 'ellipsis' }, n.title || 'Untitled'), badges),
        snippet(n), h('div', { class: 'card-meta' }, meta), shareRow,
        (n.tags || []).length ? h('div', { class: 'card-tags' }, n.tags.slice(0, 3).map((t) => h('span', { class: 'chip' }, '#' + t))) : null),
      h('button', { class: 'row-more card-more', type: 'button', 'aria-label': 'Note actions', tabindex: '-1', 'data-more': '1' }, icon('more', 18)));
    return card;
  }
  function paintTop() {
    top.replaceChildren();
    if (route.name === 'trash' && (notes.length || trashNbs.length)) {
      top.append(h('div', { class: 'banner info' }, icon('info', 18), h('span', { class: 'grow' }, 'Items are deleted permanently after 60 days. Tap a note to restore it.'),
        h('button', { class: 'btn danger sm', type: 'button', onclick: async () => { const c = notes.length + trashNbs.length; if (await confirmDialog({ title: 'Empty trash?', message: `${plural(c, 'item')} will be deleted forever.`, confirmLabel: 'Empty trash', danger: true })) { const k = await A.emptyTrash(); toast(`${plural(k, 'item')} deleted`); } } }, 'Delete all permanently')));
      if (trashNbs.length) top.append(h('div', { class: 'trash-nbs' }, h('h2', { class: 'group-h' }, 'Notebooks'), trashNbs.map((nb) => {
        const left = Math.max(0, Math.ceil((nb.trashedAt + A.TRASH_MS - Date.now()) / 864e5));
        return h('div', { class: 'trash-nb' }, h('span', { class: 'nb-ic', style: { background: (nb.color || '#4f46e5') + '26', color: nb.color } }, nb.icon || '📓'),
          h('div', { class: 'grow' }, h('b', {}, nb.name), h('small', {}, `${left} days left`)),
          h('button', { class: 'btn sm', type: 'button', onclick: async () => { await A.restoreNotebook(nb.id); toast('Notebook restored'); } }, icon('restore', 16), 'Restore'),
          h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: `Delete "${nb.name}" forever?`, message: 'Its notes are deleted too.', confirmLabel: 'Delete', danger: true })) { await A.purgeNotebook(nb.id); toast('Deleted'); } } }, 'Delete'));
      })));
    }
    if (route.name === 'all' && !query && loaded) {
      A.computeStats().then((st) => {
        if (route.name !== 'all' || query) return;
        top.append(h('div', { class: 'stats', 'aria-label': 'Your activity' },
          h('div', { class: 'stat' }, h('span', { class: 'stat-ic flame' }, icon('flame', 18)), h('div', {}, h('b', {}, st.streak), h('small', {}, st.streak === 1 ? 'day streak' : 'day streak'))),
          h('div', { class: 'stat' }, h('span', { class: 'stat-ic' }, icon('file', 18)), h('div', {}, h('b', {}, st.notes), h('small', {}, 'notes'))),
          h('div', { class: 'stat' }, h('span', { class: 'stat-ic' }, icon('edit', 18)), h('div', {}, h('b', {}, st.week), h('small', {}, 'edited this week'))),
          h('button', { class: 'stat daily', type: 'button', onclick: async () => { const n = await A.openDailyNote(); navigate('/note/' + encodeURIComponent(n.id)); } }, h('span', { class: 'stat-ic' }, icon('calendar', 18)), h('div', {}, h('b', {}, 'Today'), h('small', {}, 'Open daily note')))));
        let opened = []; try { opened = JSON.parse(localStorage.getItem('inkwell:opened') || '[]'); } catch { /* ignore */ }
        const byId = new Map(notes.map((n) => [n.id, n]));
        const row = [...new Set([...opened.filter((i) => byId.has(i)), ...[...notes].sort((a, b) => b.updatedAt - a.updatedAt).map((n) => n.id)])].slice(0, 8).map((i) => byId.get(i));
        if (row.length > 1 || (row.length === 1 && notes.length > 3)) top.append(h('div', { class: 'shelf-wrap' }, h('h2', {}, 'Continue where you left off'), h('div', { class: 'shelf' }, row.map((n, i) => {
          const lk = isNoteLocked(n);
          return h('button', { class: 'mini' + (i === 0 ? ' first' : ''), type: 'button', 'aria-label': 'Open ' + (n.title || 'Untitled'), onclick: (e) => { e.currentTarget.querySelector('.thumb').style.viewTransitionName = 'note-zoom'; openNote(n.id); } },
            h('div', { class: 'thumb' }, n.preview && !lk ? h('img', { src: n.preview, alt: '', loading: 'lazy' }) : paperEl(n.template, n.paperColor)),
            i === 0 ? h('span', { class: 'first-tag' }, 'Last opened') : null, h('span', { class: 'ellipsis' }, n.title || 'Untitled'));
        }))));
        if (!getSettings().tipsDismissed && st.notes < 6) {
          const tip = TIPS[st.notes % TIPS.length];
          top.append(h('div', { class: 'tip' }, icon('zap', 18), h('div', { class: 'grow' }, h('b', {}, tip[0]), h('span', {}, ' ' + tip[1])), iconBtn('x', 'Dismiss tips', () => { updateSettings({ tipsDismissed: true }); paintTop(); }, { size: 16, class: 'sm' })));
        }
      });
    }
  }
  function emptyFor() {
    const r = route.name;
    if (query) return emptyState({ icon: 'search', title: 'No matches', text: `Nothing found for "${query}". Try a different word or check the spelling.` });
    if (r === 'trash') return emptyState({ icon: 'trash', title: 'Trash is empty', text: 'Deleted notes wait here for 60 days before they are removed for good.' });
    if (r === 'archive') return emptyState({ icon: 'archive', title: 'Nothing archived', text: 'Archive notes you are done with. They stay searchable and out of the way.' });
    if (r === 'favorites') return emptyState({ icon: 'star', title: 'No favorites yet', text: 'Star a note from its menu to keep it close.' });
    if (r === 'tag' || r === 'smart') return emptyState({ icon: 'tag', title: 'No notes here', text: 'Nothing matches this filter yet.' });
    if (r === 'notebook') return emptyState({ icon: 'folder', title: 'This notebook is empty', text: 'Create a note here, or drag notes onto it from the sidebar list.', actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => newNoteDialog({ notebookId: route.params.id }) }, icon('plus', 18), 'New note')] });
    return emptyState({
      icon: 'edit', title: 'Write your first note', text: 'Handwrite, type, annotate PDFs and record audio. Everything works offline.',
      actions: [h('button', { class: 'btn primary lg', type: 'button', onclick: () => newNoteDialog() }, icon('plus', 20), 'New note'),
        h('div', { class: 'quick-row' }, ['planner', 'cornell', 'meeting', 'todo'].map((id) => { const p = PRESETS.find((x) => x.id === id); return h('button', { class: 'btn ghost', type: 'button', onclick: () => newNoteDialog({ preset: id }) }, p.label); }))],
    });
  }

  // ----- selection -----
  function setSelecting(on_) {
    selecting = on_; if (!on_) selected.clear();
    gridEl.classList.toggle('selecting', selecting);
    list.classList.toggle('is-selecting', selecting);
    syncSel();
  }
  function syncSel() {
    gridEl.querySelectorAll('.card').forEach((c) => { const on_ = selected.has(c.dataset.id); c.classList.toggle('sel', on_); c.setAttribute('aria-selected', String(on_)); });
    paintSel();
  }
  function toggle(id, force) {
    if (force ?? !selected.has(id)) selected.add(id); else selected.delete(id);
    if (!selecting) setSelecting(true);
    syncSel();
  }
  const selNotes = () => notes.filter((n) => selected.has(n.id));
  function paintSel() {
    selbar.hidden = !selecting;
    list.classList.toggle('is-selecting', selecting);
    if (!selecting) { selbar.replaceChildren(); return; }
    const sel = selNotes(); const none = !sel.length; const trash = route.name === 'trash';
    const b = (ic, label, fn, cls = '') => h('button', { class: 'selbtn ' + cls, type: 'button', disabled: none, onclick: fn }, icon(ic, 20), h('span', {}, label));
    const done = () => setSelecting(false);
    selbar.replaceChildren(
      iconBtn('x', 'Cancel selection', done),
      h('span', { class: 'sel-count', 'aria-live': 'polite' }, none ? 'Select notes' : `${sel.length} selected`),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { const all = selected.size === notes.length; selected.clear(); if (!all) notes.forEach((n) => selected.add(n.id)); syncSel(); } }, selected.size === notes.length && notes.length ? 'Select none' : 'Select all'),
      h('div', { class: 'sel-actions' },
        trash ? [b('restore', 'Restore', async () => { await A.restoreNotes(sel); done(); }), b('trash', 'Delete now', async () => { if (await confirmDialog({ title: 'Delete forever?', message: `${plural(sel.length, 'note')} cannot be recovered.`, confirmLabel: 'Delete', danger: true })) { await A.deleteForever(sel); done(); } }, 'danger')] : [
          b('folder', 'Move', async () => { const t = await movePicker({ title: `Move ${plural(sel.length, 'note')} to` }); if (t !== undefined) { await A.moveNotes(sel, t); done(); } }),
          b('tag', 'Tag', async () => { if (await tagDialog(sel)) done(); }),
          b('star', 'Favorite', () => A.toggleFlag(sel, 'favorite')),
          b('archive', route.name === 'archive' ? 'Unarchive' : 'Archive', async () => { await A.archiveNotes(sel); done(); }),
          b('download', 'PDF', () => A.exportNotes(sel)),
          b('trash', 'Trash', async () => { await A.trashNotes(sel); done(); }, 'danger')]));
  }

  // ----- interactions -----
  async function openNote(id) {
    const n = notes.find((x) => x.id === id) || (await import('../core/db.js').then((m) => m.getRecord('notes', id)));
    if (n && !(await requireUnlock(n))) return;
    document.querySelector(`.card[data-id="${CSS.escape(id)}"] .thumb`)?.style.setProperty('view-transition-name', 'note-zoom');
    navigate('/note/' + encodeURIComponent(id));
  }
  const markPreview = () => gridEl.querySelectorAll('.card').forEach((c) => c.classList.toggle('previewing', c.dataset.id === previewId));
  let suppressClick = 0;
  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    if (Date.now() < suppressClick) return;
    const id = card.dataset.id;
    if (e.target.closest('[data-more]')) { menuFor(id, { anchor: e.target.closest('[data-more]') }); return; }
    if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) { toggle(id); return; }
    if (route.name === 'trash') { menuFor(id, { anchor: card }); return; }
    if (isDesktop() && finePointer()) { previewId = id; preview.show(notes.find((n) => n.id === id)); markPreview(); return; }
    openNote(id);
  });
  gridEl.addEventListener('dblclick', (e) => { const c = e.target.closest('.card'); if (c && !selecting && route.name !== 'trash') openNote(c.dataset.id); });
  gridEl.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('.card'); if (!c) return;
    if (e.key === 'Enter') { e.preventDefault(); selecting ? toggle(c.dataset.id) : openNote(c.dataset.id); }
    else if (e.key === ' ') { e.preventDefault(); toggle(c.dataset.id); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); menuFor(c.dataset.id, { anchor: c }); }
    else if (e.key.startsWith('Arrow')) {
      const cards = [...gridEl.querySelectorAll('.card')]; const i = cards.indexOf(c); const r = c.getBoundingClientRect();
      let t = null;
      if (e.key === 'ArrowRight') t = cards[i + 1]; if (e.key === 'ArrowLeft') t = cards[i - 1];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        t = cards.filter((x) => (x.getBoundingClientRect().top - r.top) * dir > 4).sort((a, b) => Math.abs(a.getBoundingClientRect().top - r.top) - Math.abs(b.getBoundingClientRect().top - r.top) || Math.abs(a.getBoundingClientRect().left - r.left) - Math.abs(b.getBoundingClientRect().left - r.left))[0];
        if (dir < 0) t = cards.filter((x) => x.getBoundingClientRect().top < r.top - 4).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top || Math.abs(a.getBoundingClientRect().left - r.left) - Math.abs(b.getBoundingClientRect().left - r.left))[0];
      }
      if (t) { e.preventDefault(); t.focus(); t.scrollIntoView({ block: 'nearest' }); }
    }
  });
  function menuFor(id, pos) {
    const n = notes.find((x) => x.id === id); if (!n) return;
    openMenu(noteMenuItems(n, { onOpen: () => openNote(id), onSelect: () => toggle(id, true) }), { ...pos, title: n.title || 'Untitled' });
  }
  let lastMenu = 0;
  gridEl.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    e.preventDefault(); if (Date.now() - lastMenu < 600) return; lastMenu = Date.now();
    menuFor(card.dataset.id, { x: e.clientX, y: e.clientY });
  });
  // long-press (touch / pen)
  let lp = null;
  gridEl.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card'); if (!card || e.pointerType === 'mouse' || selecting) return;
    const sx = e.clientX, sy = e.clientY;
    const cancel = () => { clearTimeout(lp.t); gridEl.removeEventListener('pointermove', mv); lp = null; };
    const mv = (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cancel(); };
    lp = { t: setTimeout(() => { lp = null; gridEl.removeEventListener('pointermove', mv); suppressClick = Date.now() + 700; lastMenu = Date.now(); navigator.vibrate?.(10); menuFor(card.dataset.id, { x: sx, y: sy }); }, 480) };
    gridEl.addEventListener('pointermove', mv);
    ['pointerup', 'pointercancel'].forEach((t) => gridEl.addEventListener(t, () => lp && cancel(), { once: true }));
  });
  gridEl.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    const ids = selected.has(card.dataset.id) ? [...selected] : [card.dataset.id];
    e.dataTransfer.setData(DT, JSON.stringify({ kind: 'notes', ids })); e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
    card.addEventListener('dragend', () => card.classList.remove('dragging'), { once: true });
  });

  // pull to refresh (touch): syncs and reloads
  const ptr = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('refresh', 20));
  list.insertBefore(ptr, body);
  let py = null, pd = 0;
  body.addEventListener('touchstart', (e) => { py = body.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; pd = 0; }, { passive: true });
  body.addEventListener('touchmove', (e) => {
    if (py == null) return;
    pd = Math.max(0, (e.touches[0].clientY - py) * 0.5);
    if (pd > 4) { ptr.style.setProperty('--pull', Math.min(pd, 90) + 'px'); ptr.classList.toggle('ready', pd > 64); ptr.classList.add('pulling'); }
  }, { passive: true });
  const endPull = async () => {
    if (py == null) return; const go = pd > 64; py = null; ptr.classList.remove('pulling', 'ready');
    if (!go) { ptr.style.setProperty('--pull', '0px'); return; }
    ptr.classList.add('spin'); ptr.style.setProperty('--pull', '48px');
    try { await (await import('../core/sync.js')).syncNow(); } catch { /* offline or not configured */ }
    await refresh();
    ptr.classList.remove('spin'); ptr.style.setProperty('--pull', '0px');
  };
  body.addEventListener('touchend', endPull); body.addEventListener('touchcancel', endPull);

  on('notes:changed', refreshSoon); on('notebooks:changed', refreshSoon); on('lock:changed', () => { cache.clear(); refreshSoon(); });
  on('settings:changed', (s) => { if (loaded) { cache.clear(); refreshSoon(); } });

  return {
    el,
    reset() { cache.clear(); notes = []; items = []; loaded = false; previewId = null; selected.clear(); selecting = false; presence.clear(); gridEl.replaceChildren(); },
    show(r) {
      const changed = r.path !== route.path || !loaded;
      route = r;
      if (changed) { query = ''; searchIn.value = ''; selected.clear(); selecting = false; previewId = null; }
      if (!loaded) { body.querySelector('.empty')?.remove(); gridEl.hidden = false; gridEl.replaceChildren(...skeletonGrid(8).children); }
      refresh();
      if (r.name === 'search') setTimeout(() => searchIn.focus(), 50);
    },
    focusSearch() { searchIn.focus(); searchIn.select(); },
    isSelecting: () => selecting,
    clearSelection: () => setSelecting(false),
    selectAll() { if (!selecting) setSelecting(true); notes.forEach((n) => selected.add(n.id)); syncSel(); },
    trashSelected() { const s = selNotes(); if (s.length && route.name !== 'trash') { A.trashNotes(s); setSelecting(false); } },
    openFocused() { const id = previewId || (document.activeElement?.dataset?.id); if (id) openNote(id); },
    get hasPreview() { return !!previewId; },
  };
}
