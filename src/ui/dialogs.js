import { h, icon, openModal, openMenu, promptDialog, confirmDialog, chip } from './dom.js';
import { getAll, getRecord } from '../core/db.js';
import { navigate, noteHref } from '../core/router.js';
import { toast } from '../core/store.js';
import { getSettings } from '../core/settings.js';
import { TEMPLATES, PRESETS, PAPER_COLORS, NB_COLORS, NB_ICONS } from './templates.js';
import * as A from './actions.js';
import { hasUi, loadUi } from './config.js';
import { hasLock, lockNote, removeLock } from './lock.js';

export const paperEl = (tpl, color, cls = '') => h('div', { class: `paper t-${tpl || 'blank'} ${color ? 'colored' : ''} ${cls}`, style: color ? { '--paper': color } : null });

// ---------- new note ----------
export async function newNoteDialog({ notebookId = null, preset = null } = {}) {
  const s = getSettings();
  const nbs = await A.getNotebooks();
  const st = { template: s.defaultTemplate || 'lined', paper: s.defaultPaper ?? null, title: '', preset: null, notebookId, text: undefined, tags: [] };
  const grid = h('div', { class: 'tpl-grid', role: 'radiogroup', 'aria-label': 'Template' });
  const gal = h('div', { class: 'tpl-gal' });
  const papers = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Paper color' });
  const titleIn = h('input', { class: 'input', placeholder: 'Untitled', 'aria-label': 'Title', autocomplete: 'off' });
  titleIn.addEventListener('input', () => { st.title = titleIn.value; });
  const nbSel = h('select', { class: 'input', 'aria-label': 'Notebook', onchange: (e) => { st.notebookId = e.target.value || null; } },
    h('option', { value: '' }, 'No notebook'), nbs.map((n) => h('option', { value: n.id, selected: n.id === notebookId }, A.notebookPath(nbs, n.id))));
  const paint = () => {
    grid.replaceChildren(...TEMPLATES.map((t) => {
      const b = h('button', { type: 'button', class: 'tpl' + (st.template === t.id && !st.preset ? ' sel' : ''), role: 'radio', 'aria-checked': String(st.template === t.id && !st.preset), onclick: () => { st.template = t.id; st.preset = null; st.text = ''; paint(); } }, paperEl(t.id, st.paper), h('span', {}, t.label));
      return b;
    }));
    gal.replaceChildren(...PRESETS.map((p) => h('button', { type: 'button', class: 'tpl small' + (st.preset === p.id ? ' sel' : ''), onclick: () => { st.preset = p.id; st.template = p.base; st.text = p.text; titleIn.placeholder = p.title; paint(); } }, paperEl(p.base, st.paper), h('span', {}, p.label))));
    papers.replaceChildren(...PAPER_COLORS.map((c) => h('button', { type: 'button', class: 'swatch' + (st.paper === c.v ? ' sel' : ''), role: 'radio', 'aria-checked': String(st.paper === c.v), 'aria-label': c.label, title: c.label, style: { background: c.v || '#fff' }, onclick: () => { st.paper = c.v; paint(); } }, st.paper === c.v ? icon('check', 14) : null)));
  };
  if (preset) { const p = PRESETS.find((x) => x.id === preset); if (p) { st.preset = p.id; st.template = p.base; st.text = p.text; titleIn.placeholder = p.title; } }
  paint();
  let created = null;
  const m = openModal({
    title: 'New note', size: 'lg', className: 'newnote',
    body: [
      h('label', { class: 'field-label' }, 'Title'), titleIn,
      h('label', { class: 'field-label' }, 'Page style'), grid,
      h('label', { class: 'field-label' }, 'Template gallery'), gal,
      h('div', { class: 'row-2' }, h('div', {}, h('label', { class: 'field-label' }, 'Paper'), papers), h('div', {}, h('label', { class: 'field-label' }, 'Notebook'), nbSel)),
    ],
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Create note', kind: 'primary', onClick: async () => {
        created = await A.createNote({ title: st.title.trim() || undefined, template: st.template, paperColor: st.paper, notebookId: st.notebookId, preset: st.preset });
        if (!st.title.trim() && !st.preset) { created.title = ''; }
      },
    }],
  });
  await m.closed;
  if (created) navigate('/note/' + encodeURIComponent(created.id));
  return created;
}
export async function quickNote(opts = {}) {
  const n = await A.createNote(opts);
  navigate('/note/' + encodeURIComponent(n.id));
  return n;
}

// ---------- notebook edit ----------
export async function notebookDialog({ notebook = null, parentId = null } = {}) {
  const nbs = await A.getNotebooks();
  const st = { name: notebook?.name || '', color: notebook?.color || NB_COLORS[0], icon: notebook?.icon || NB_ICONS[0], parentId: notebook ? notebook.parentId : parentId };
  const banned = notebook ? A.descendantIds(nbs, notebook.id) : new Set();
  const nameIn = h('input', { class: 'input', value: st.name, placeholder: 'e.g. Biology 101', 'aria-label': 'Name', autocomplete: 'off', oninput: (e) => { st.name = e.target.value; } });
  const colors = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' });
  const icons = h('div', { class: 'icon-pick', role: 'radiogroup', 'aria-label': 'Icon' });
  const paint = () => {
    colors.replaceChildren(...NB_COLORS.map((c) => h('button', { type: 'button', class: 'swatch' + (st.color === c ? ' sel' : ''), role: 'radio', 'aria-checked': String(st.color === c), 'aria-label': c, style: { background: c }, onclick: () => { st.color = c; paint(); } }, st.color === c ? icon('check', 14) : null)));
    icons.replaceChildren(...NB_ICONS.map((i) => h('button', { type: 'button', class: 'emoji' + (st.icon === i ? ' sel' : ''), role: 'radio', 'aria-checked': String(st.icon === i), 'aria-label': i, onclick: () => { st.icon = i; paint(); } }, i)));
  };
  paint();
  const parentSel = h('select', { class: 'input', 'aria-label': 'Inside', onchange: (e) => { st.parentId = e.target.value || null; } },
    h('option', { value: '' }, 'Top level'), nbs.filter((n) => !banned.has(n.id)).map((n) => h('option', { value: n.id, selected: n.id === st.parentId }, A.notebookPath(nbs, n.id))));
  let saved = null;
  const m = openModal({
    title: notebook ? 'Edit notebook' : 'New notebook', size: 'sm',
    body: [h('label', { class: 'field-label' }, 'Name'), nameIn, h('label', { class: 'field-label' }, 'Color'), colors, h('label', { class: 'field-label' }, 'Icon'), icons, h('label', { class: 'field-label' }, 'Inside'), parentSel],
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: notebook ? 'Save' : 'Create', kind: 'primary', onClick: async () => {
        if (!st.name.trim()) { nameIn.focus(); return false; }
        saved = notebook ? await A.updateNotebook(notebook.id, { name: st.name.trim(), color: st.color, icon: st.icon, parentId: st.parentId }) : await A.createNotebook(st);
      },
    }],
  });
  await m.closed;
  return saved;
}
export async function deleteNotebookFlow(nb) {
  const ok = await confirmDialog({ title: `Delete "${nb.name}"?`, message: 'The notebook, its sub-notebooks and notes move to Trash. You can restore them for 60 days.', confirmLabel: 'Move to trash', danger: true });
  if (ok) { await A.deleteNotebook(nb.id); toast('Notebook moved to trash', { action: { label: 'Undo', onClick: () => A.restoreNotebook(nb.id) } }); }
  return ok;
}

// ---------- move picker ----------
/** resolves: string id, null (no notebook) or undefined (cancelled) */
export async function movePicker({ title = 'Move to', current } = {}) {
  const nbs = await A.getNotebooks();
  return new Promise((res) => {
    let pick; let done = false;
    const rows = [];
    const mk = (label, id, depth, ic, color) => h('button', { type: 'button', class: 'pick-row' + (current === id ? ' cur' : ''), style: { paddingLeft: 12 + depth * 18 + 'px' }, onclick: () => { pick = id; done = true; m.close(); } },
      h('span', { class: 'nb-ic', style: color ? { background: color + '26', color } : null }, ic || '📁'), h('span', { class: 'grow' }, label));
    rows.push(mk('Library (no notebook)', null, 0, '🗂️'));
    const walk = (pid, d) => nbs.filter((n) => (n.parentId || null) === pid).forEach((n) => { rows.push(mk(n.name, n.id, d, n.icon, n.color)); walk(n.id, d + 1); });
    walk(null, 0);
    const m = openModal({ title, size: 'sm', body: h('div', { class: 'pick-list' }, rows), actions: [{ label: 'Cancel', kind: 'ghost' }] });
    m.closed.then(() => res(done ? pick : undefined));
  });
}

// ---------- tags ----------
export async function tagDialog(notes) {
  const objs = [];
  for (const n of notes) objs.push(typeof n === 'string' ? await getRecord('notes', n) : n);
  const list = objs.filter(Boolean);
  const all = await getAll('notes');
  const known = [...new Set(all.flatMap((n) => A.tagsOf(n)))].sort();
  const state = new Map(); const init = new Map();
  for (const t of known) {
    const c = list.filter((n) => A.tagsOf(n).includes(t)).length;
    const v = c === 0 ? 'none' : c === list.length ? 'all' : 'some';
    state.set(t, v); init.set(t, v);
  }
  const wrap = h('div', { class: 'tag-pick' });
  const paint = () => wrap.replaceChildren(...(state.size ? [...state.keys()].map((t) => h('button', { type: 'button', class: 'tagbtn ' + state.get(t), 'aria-pressed': state.get(t) === 'all' ? 'true' : state.get(t) === 'some' ? 'mixed' : 'false', onclick: () => { state.set(t, state.get(t) === 'all' ? 'none' : 'all'); paint(); } }, '#' + t, state.get(t) === 'all' ? icon('check', 14) : null)) : [h('p', { class: 'hint' }, 'No tags yet. Add your first one below.')]));
  paint();
  const inp = h('input', { class: 'input', placeholder: 'New tag, press Enter', 'aria-label': 'New tag', autocomplete: 'off' });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      const t = inp.value.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
      if (t) { state.set(t, 'all'); if (!init.has(t)) init.set(t, 'none'); inp.value = ''; paint(); }
    }
  });
  let ok = false;
  const m = openModal({
    title: list.length > 1 ? `Tags for ${list.length} notes` : 'Tags', size: 'sm', body: [wrap, h('label', { class: 'field-label' }, 'Add tag'), inp],
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Apply', kind: 'primary', onClick: async () => {
        const add = [], remove = [];
        for (const [t, v] of state) { if (v === 'all' && init.get(t) !== 'all') add.push(t); if (v === 'none' && init.get(t) !== 'none') remove.push(t); }
        await A.applyTags(list, add, remove); ok = true;
      },
    }],
  });
  await m.closed;
  return ok;
}

// ---------- note menu ----------
export function noteMenuItems(note, { onOpen, onSelect, inTrash = note.trashedAt } = {}) {
  if (inTrash) return [
    { label: 'Restore', icon: 'restore', onClick: () => A.restoreNotes([note]) },
    { label: 'Delete permanently now', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Delete forever?', message: 'This note cannot be recovered.', confirmLabel: 'Delete', danger: true })) { await A.deleteForever([note]); toast('Deleted'); } } },
  ];
  return [
    onOpen && { label: 'Open', icon: 'open', onClick: onOpen },
    { label: 'Rename', icon: 'edit', onClick: async () => { const t = await promptDialog({ title: 'Rename note', value: note.title || '', placeholder: 'Untitled' }); if (t !== null) await A.renameNote(note.id, t); } },
    { label: note.pinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: () => A.toggleFlag([note], 'pinned') },
    { label: note.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: () => A.toggleFlag([note], 'favorite') },
    { divider: true },
    { label: 'Move to...', icon: 'folder', onClick: async () => { const t = await movePicker({ current: note.notebookId }); if (t !== undefined) await A.moveNotes([note], t); } },
    { label: 'Tags...', icon: 'tag', onClick: () => tagDialog([note]) },
    { label: 'Duplicate', icon: 'copy', onClick: () => A.duplicateNote(note.id) },
    { label: hasLock(note) ? 'Remove lock' : 'Lock with passcode', icon: 'lock', onClick: async () => { const fresh = await getRecord('notes', note.id); hasLock(fresh) ? removeLock(fresh) : lockNote(fresh); } },
    hasUi('share') && { label: 'Share...', icon: 'link', onClick: async () => { const m = await loadUi('share'); m?.openShareDialog?.(note.id); } },
    { label: note.archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: () => A.archiveNotes([note]) },
    { divider: true },
    { label: 'Export as PDF', icon: 'download', onClick: () => A.exportNotes([note]) },
    { divider: true },
    onSelect && { label: 'Select', icon: 'select', onClick: onSelect },
    { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => A.trashNotes([note]) },
  ];
}

export const SHORTCUTS = [
  ['Ctrl/Cmd + N', 'New note'], ['Ctrl/Cmd + Shift + N', 'New notebook'], ['Ctrl/Cmd + K', 'Command palette'],
  ['/', 'Search notes'], ['Ctrl/Cmd + D', 'Daily note'], ['Ctrl/Cmd + \\', 'Toggle sidebar'], ['Ctrl/Cmd + Shift + F', 'Focus (zen) mode'],
  ['Ctrl/Cmd + A', 'Select all (in select mode)'], ['Delete', 'Trash selected notes'], ['Enter', 'Open selected note'], ['Esc', 'Close / clear selection'], ['?', 'This cheat sheet'],
];
export function shortcutsDialog() {
  openModal({
    title: 'Keyboard shortcuts', size: 'sm',
    body: h('dl', { class: 'shortcuts' }, SHORTCUTS.flatMap(([k, d]) => [h('dt', {}, k.split(' + ').flatMap((x, i, a) => [h('kbd', {}, x), i < a.length - 1 ? ' + ' : ''])), h('dd', {}, d)])),
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}
export { chip, noteHref, openMenu };
