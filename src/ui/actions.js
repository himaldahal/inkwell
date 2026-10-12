import { getAll, getAllRaw, getRecord, putRecord, softDelete, getDB, blankNote, listNotes, newId, putAsset } from '../core/db.js';
import { emit, toast } from '../core/store.js';
import { stripHtml } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { PRESETS, SMART } from './templates.js';

const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 864e5;

// ---------- notes ----------
export async function createNote(opts = {}) {
  const s = getSettings();
  const preset = PRESETS.find((p) => p.id === opts.preset);
  const tpl = opts.template || preset?.base || s.defaultTemplate || 'lined';
  const text = opts.text ?? preset?.text ?? '';
  const note = blankNote({
    title: opts.title ?? preset?.title ?? '', notebookId: opts.notebookId ?? s.defaultNotebook ?? null, template: tpl,
    paperColor: opts.paperColor === undefined ? s.defaultPaper : opts.paperColor,
    text, textIndex: stripHtml(text), tags: opts.tags || [],
  });
  note.pages[0].bg = tpl;
  if (preset) note.preset = preset.id;
  await putRecord('notes', note);
  return note;
}
export async function patchNotes(ids, fn) {
  for (const id of ids) {
    const r = await getRecord('notes', id);
    if (!r || r.deleted) continue;
    if (fn(r) === false) continue;
    await putRecord('notes', r, { silent: true });
  }
  emit('notes:changed', { bulk: true });
}
const idsOf = (notes) => notes.map((n) => (typeof n === 'string' ? n : n.id));
const objs = (notes) => notes.filter((n) => typeof n !== 'string');
const allHave = (notes, k) => objs(notes).length > 0 && objs(notes).every((n) => !!n[k]);

export async function toggleFlag(notes, key) {
  const on = !allHave(notes, key);
  await patchNotes(idsOf(notes), (n) => { n[key] = on; });
  return on;
}
export async function trashNotes(notes, { undo = true } = {}) {
  const ids = idsOf(notes);
  if (getSettings().confirmDelete) { const { confirmDialog } = await import('./dom.js'); if (!(await confirmDialog({ title: 'Move to trash?', message: `${ids.length} note(s) will go to Trash.`, confirmLabel: 'Move to trash', danger: true }))) return; }
  await patchNotes(ids, (n) => { n.trashedAt = Date.now(); });
  toast(ids.length === 1 ? 'Moved to trash' : `${ids.length} notes moved to trash`, undo ? { action: { label: 'Undo', onClick: () => restoreNotes(ids, { silentToast: true }) } } : {});
}
export async function restoreNotes(notes, { silentToast = false } = {}) {
  const ids = idsOf(notes);
  await patchNotes(ids, (n) => { n.trashedAt = null; });
  if (!silentToast) toast(ids.length === 1 ? 'Note restored' : `${ids.length} notes restored`);
}
export async function archiveNotes(notes) {
  const ids = idsOf(notes);
  const flag = !allHave(notes, 'archived');
  await patchNotes(ids, (n) => { n.archived = flag; });
  toast(flag ? 'Archived' : 'Unarchived', { action: { label: 'Undo', onClick: () => patchNotes(ids, (n) => { n.archived = !flag; }) } });
}
export async function moveNotes(notes, notebookId) {
  const ids = idsOf(notes);
  const before = new Map();
  await patchNotes(ids, (n) => { before.set(n.id, n.notebookId); n.notebookId = notebookId; });
  const nb = notebookId ? (await getRecord('notebooks', notebookId))?.name : 'Library';
  toast(`Moved ${ids.length === 1 ? 'note' : ids.length + ' notes'} to ${nb || 'notebook'}`, {
    action: { label: 'Undo', onClick: () => patchNotes(ids, (n) => { n.notebookId = before.get(n.id) ?? null; }) },
  });
}
export async function deleteForever(notes) {
  for (const id of idsOf(notes)) {
    const db = await getDB();
    const assets = await db.getAllFromIndex('assets', 'noteId', id);
    for (const a of assets) if (!a.deleted) await softDelete('assets', a.id);
    await softDelete('notes', id);
  }
}
export async function emptyTrash() {
  const t = await listNotes({ view: 'trash' });
  await deleteForever(t);
  const nbs = await getTrashedNotebooks();
  for (const nb of nbs) await softDelete('notebooks', nb.id);
  return t.length + nbs.length;
}
export async function purgeOldTrash() {
  const old = (await listNotes({ view: 'trash' })).filter((n) => Date.now() - n.trashedAt > TRASH_MS);
  if (old.length) await deleteForever(old);
  for (const nb of (await getTrashedNotebooks()).filter((n) => Date.now() - n.trashedAt > TRASH_MS)) await softDelete('notebooks', nb.id);
}
export const trashDaysLeft = (n) => Math.max(0, Math.ceil((n.trashedAt + TRASH_MS - Date.now()) / 864e5));

export async function duplicateNote(id) {
  const src = await getRecord('notes', id);
  if (!src) return null;
  const c = structuredClone(src);
  c.id = newId(); c.title = (src.title || 'Untitled') + ' copy';
  c.createdAt = Date.now(); c.trashedAt = null; c.pinned = false; c.deleted = false; delete c.lock;
  c.pages = (c.pages || []).map((p) => ({ ...p, id: newId() }));
  await putRecord('notes', c);
  toast('Duplicated');
  return c;
}
export async function renameNote(id, title) {
  await patchNotes([id], (n) => { n.title = title.trim(); });
}
export async function applyTags(notes, add, remove) {
  await patchNotes(idsOf(notes), (n) => {
    const set = new Set(n.tags || []);
    add.forEach((t) => set.add(t)); remove.forEach((t) => set.delete(t));
    n.tags = [...set];
  });
}
/** PDF is the only export format offered. */
export async function exportNotes(notes) {
  try {
    const m = await import('../features/export.js');
    for (const n of notes) await m.exportNote(typeof n === 'string' ? await getRecord('notes', n) : n, 'pdf');
    toast('PDF export ready');
  } catch (e) {
    console.error(e);
    toast('Export is not available right now', { type: 'error' });
  }
}
export async function exportNotebookPdfs(notebookId) {
  try {
    const m = await import('../features/export.js');
    await m.exportNotebook(notebookId, 'pdf');
  } catch (e) { console.error(e); toast('Export is not available right now', { type: 'error' }); }
}

// ---------- daily note / images ----------
export async function openDailyNote() {
  const d = new Date();
  const title = 'Daily - ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const found = (await getAll('notes')).find((n) => n.title === title && !n.trashedAt);
  if (found) return found;
  return createNote({ title, preset: 'planner', tags: ['daily'] });
}
export async function importImageAsNote(file) {
  const note = await createNote({ title: file.name.replace(/\.[^.]+$/, ''), template: 'blank' });
  const asset = await putAsset({ noteId: note.id, kind: 'image', blob: file, mime: file.type });
  let w = 600, hh = 400;
  try { const bm = await createImageBitmap(file); const k = Math.min(1, 700 / bm.width); w = Math.round(bm.width * k); hh = Math.round(bm.height * k); bm.close?.(); } catch { /* keep default */ }
  note.pages[0].items.push({ id: newId(), type: 'image', x: 60, y: 60, w, h: hh, rotation: 0, assetId: asset.id });
  await putRecord('notes', note);
  return note;
}

// ---------- notebooks ----------
export const getNotebooks = async () => (await getAll('notebooks')).filter((n) => !n.trashedAt).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
export async function createNotebook({ name, color, icon, parentId = null }) {
  const all = await getAll('notebooks');
  const order = all.reduce((m, n) => Math.max(m, n.order || 0), 0) + 1;
  return putRecord('notebooks', { name: name.trim() || 'Untitled', color: color || '#4f46e5', icon: icon || '📓', parentId, order });
}
export async function updateNotebook(id, patch) {
  const r = await getRecord('notebooks', id);
  if (!r) return;
  Object.assign(r, patch);
  return putRecord('notebooks', r);
}
export function descendantIds(notebooks, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const n of notebooks) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true; } }
  return out;
}
export const getTrashedNotebooks = async () => (await getAll('notebooks')).filter((n) => n.trashedAt);
/** moves a notebook, its sub-notebooks and their notes to the trash (restorable for 30 days) */
export async function deleteNotebook(id) {
  const nbs = await getAll('notebooks');
  const ids = descendantIds(nbs, id);
  const now = Date.now();
  for (const nb of nbs.filter((n) => ids.has(n.id) && !n.trashedAt)) { nb.trashedAt = now; nb.trashedBy = id; await putRecord('notebooks', nb, { silent: true }); }
  await patchNotes((await getAll('notes')).filter((n) => ids.has(n.notebookId) && !n.trashedAt).map((n) => n.id), (n) => { n.trashedAt = now; n.trashedBy = id; });
  emit('notebooks:changed', { bulk: true });
}
export async function restoreNotebook(id) {
  const nbs = await getAll('notebooks');
  const group = nbs.filter((n) => n.trashedBy === id || n.id === id);
  const gids = new Set(group.map((n) => n.id));
  const parent = nbs.find((n) => n.id === (group.find((n) => n.id === id)?.parentId));
  for (const nb of group) { nb.trashedAt = null; delete nb.trashedBy; if (nb.id === id && parent?.trashedAt) nb.parentId = null; await putRecord('notebooks', nb, { silent: true }); }
  await patchNotes((await getAll('notes')).filter((n) => n.trashedBy === id).map((n) => n.id), (n) => { n.trashedAt = null; delete n.trashedBy; });
  emit('notebooks:changed', { bulk: true });
}
export async function purgeNotebook(id) {
  const nbs = await getAll('notebooks');
  const group = nbs.filter((n) => n.trashedBy === id || n.id === id);
  await deleteForever((await getAll('notes')).filter((n) => n.trashedBy === id));
  for (const nb of group) await softDelete('notebooks', nb.id);
}
export function notebookPath(nbs, id) {
  const parts = []; let cur = nbs.find((n) => n.id === id); let guard = 0;
  while (cur && guard++ < 20) { parts.unshift(cur.name); cur = nbs.find((n) => n.id === cur.parentId); }
  return parts.join(' / ');
}

// ---------- queries ----------
export async function loadView(route, notebooks) {
  const n = route.name;
  if (n === 'trash' || n === 'archive' || n === 'favorites') return listNotes({ view: n });
  if (n === 'notebook') {
    const ids = descendantIds(notebooks, route.params.id);
    return (await listNotes({ view: 'all' })).filter((x) => ids.has(x.notebookId));
  }
  if (n === 'public') return (await listNotes({ view: 'all' })).filter((x) => shareInfo(x).public);
  if (n === 'shared') return (await listNotes({ view: 'all' })).filter((x) => shareInfo(x).incoming);
  if (n === 'tag') return listNotes({ view: 'tag', tag: route.params.tag });
  if (n === 'smart') { const f = SMART.find((s) => s.id === route.params.id); return (await listNotes({ view: 'all' })).filter((x) => f?.test(x)); }
  return listNotes({ view: 'all' });
}
export async function computeStats() {
  const notes = (await getAll('notes')).filter((n) => !n.trashedAt);
  const days = new Set(notes.map((n) => new Date(n.updatedAt).toDateString()));
  let streak = 0; const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return { notes: notes.length, streak, week: notes.filter((n) => n.updatedAt > Date.now() - 7 * 864e5).length, pdfs: notes.filter((n) => (n.pages || []).some((p) => p.type === 'pdf')).length };
}
export { getAllRaw };

/** Defensive reader for sharing metadata that the sync layer may attach to a note. */
export function shareInfo(n) {
  const sh = n.share || n.sharing || {};
  const role = n.sharedRole || n.role || sh.role || sh.permission || n.permission || null;
  const outgoing = !!(n.shared || sh.shared || (Array.isArray(n.sharedWith) ? n.sharedWith.length : n.sharedWith) || (Array.isArray(n.shares) && n.shares.length));
  return {
    incoming: !!n.sharedBy, outgoing,
    public: !!(n.publicLink || n.publicToken || n.isPublic || sh.public || sh.token),
    protectedLink: !!(n.publicPassword || n.passwordProtected || sh.password || sh.passwordProtected),
    canEdit: role === 'editor' || role === 'edit' || role === 'can-edit',
    viewOnly: role === 'viewer' || role === 'view' || role === 'view-only',
  };
}
