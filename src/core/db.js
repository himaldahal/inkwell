import { openDB } from 'idb';
import { newId } from './utils.js';
import { emit } from './store.js';

export { newId };
const STORES = ['notebooks', 'notes', 'assets'];
let dbp;
export function getDB() {
  if (!dbp) {
    dbp = openDB('inkwell', 1, {
      upgrade(db) {
        for (const s of STORES) {
          const st = db.createObjectStore(s, { keyPath: 'id' });
          st.createIndex('updatedAt', 'updatedAt');
          st.createIndex('dirty', 'dirty');
          if (s === 'notes') { st.createIndex('notebookId', 'notebookId'); }
          if (s === 'assets') { st.createIndex('noteId', 'noteId'); }
        }
        db.createObjectStore('meta');
      },
    });
  }
  return dbp;
}
const evtFor = (s) => (s === 'notebooks' ? 'notebooks:changed' : 'notes:changed');

export async function putRecord(store, rec, { silent = false } = {}) {
  const db = await getDB();
  rec.id ||= newId();
  rec.createdAt ||= Date.now();
  rec.updatedAt = Date.now();
  rec.deleted = !!rec.deleted;
  rec.dirty = 1;
  await db.put(store, rec);
  if (!silent) emit(evtFor(store), { id: rec.id });
  return rec;
}
/** write without touching dirty/updatedAt (used by sync when applying remote records) */
export async function rawPut(store, rec, { silent = false } = {}) {
  const db = await getDB();
  await db.put(store, rec);
  if (!silent) emit(evtFor(store), { id: rec.id, remote: true });
  return rec;
}
export async function getRecord(store, id) { return (await getDB()).get(store, id); }
export async function getAll(store) { return (await (await getDB()).getAll(store)).filter((r) => !r.deleted); }
export async function getAllRaw(store) { return (await getDB()).getAll(store); }
export async function getDirty(store) { return (await getDB()).getAllFromIndex(store, 'dirty', 1); }
export async function softDelete(store, id) {
  const r = await getRecord(store, id);
  if (!r) return;
  r.deleted = true;
  if (store === 'assets') delete r.blob; // keep tombstone small
  return putRecord(store, r);
}
export async function getMeta(k, d) { const v = await (await getDB()).get('meta', k); return v === undefined ? d : v; }
export async function setMeta(k, v) { await (await getDB()).put('meta', v, k); }

export async function putAsset({ noteId, kind, blob, mime, id }) {
  return putRecord('assets', { id: id || newId(), noteId, kind, blob, mime: mime || blob.type, size: blob.size });
}
export async function getAsset(id) { return getRecord('assets', id); }

export function blankNote(over = {}) {
  return {
    id: newId(), title: '', notebookId: null, tags: [], pinned: false, favorite: false, archived: false,
    trashedAt: null, template: 'lined', paperColor: null,
    pages: [{ id: newId(), type: 'draw', width: 820, height: 1160, strokes: [], items: [] }],
    text: '', textIndex: '', preview: null, recordings: [], ...over,
  };
}

/** view: 'all'|'favorites'|'recent'|'archive'|'trash'|'tag'|'notebook' */
export async function listNotes({ notebookId, tag, search, view = 'all' } = {}) {
  const all = await getAll('notes');
  const q = (search || '').trim().toLowerCase();
  let out = all.filter((n) => {
    if (view === 'trash') return !!n.trashedAt;
    if (n.trashedAt) return false;
    if (view === 'archive') return n.archived;
    if (n.archived) return false;
    if (view === 'favorites' && !n.favorite) return false;
    if (notebookId !== undefined && notebookId !== null && n.notebookId !== notebookId) return false;
    if (tag && !(n.tags || []).includes(tag)) return false;
    if (q && !((n.title || '') + ' ' + (n.textIndex || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
  out.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  return out;
}
