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
    title: opts.title ?? preset?.title ?? '', notebookId: opts.notebookId ?? null, template: tpl,
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
  return t.length;
}
export async function purgeOldTrash() {
  const old = (await listNotes({ view: 'trash' })).filter((n) => Date.now() - n.trashedAt > TRASH_MS);
  if (old.length) await deleteForever(old);
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
export async function exportNotes(notes, fmt) {
  try {
    const m = await import('../features/export.js');
    for (const n of notes) await m.exportNote(typeof n === 'string' ? await getRecord('notes', n) : n, fmt);
    toast('Export ready');
  } catch (e) {
    console.error(e);
    toast('Export is not available right now', { type: 'error' });
  }
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
export const getNotebooks = async () => (await getAll('notebooks')).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
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
export async function deleteNotebook(id) {
  const nbs = await getAll('notebooks');
  const me = nbs.find((n) => n.id === id);
  if (!me) return;
  for (const c of nbs.filter((n) => n.parentId === id)) await updateNotebook(c.id, { parentId: me.parentId || null });
  await patchNotes((await getAll('notes')).filter((n) => n.notebookId === id).map((n) => n.id), (n) => { n.notebookId = me.parentId || null; });
  await softDelete('notebooks', id);
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
  if (n === 'shared') return (await listNotes({ view: 'all' })).filter((x) => x.sharedBy);
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
