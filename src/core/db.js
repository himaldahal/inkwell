import { openDB } from 'idb';
import { newId } from './utils.js';
import { emit } from './store.js';

export { newId };
const STORES = ['notebooks', 'notes', 'assets'];
/* Per-user databases: `inkwell-<userId>`. Account/device keys live in a small global DB so they are readable before sign-in. */
const GLOBAL_KEYS = new Set(['sync:auth', 'deviceId', 'serverConfig', 'accountInfo', 'sync:config', 'appLock', 'legacyAdopted']);
let dbp, gdbp;
let uid = null;
try { uid = localStorage.getItem('inkwell:uid') || null; } catch { /* storage unavailable */ }
export const currentUser = () => uid;
/** point the data layer at another user's database (null = signed out). Closes the old one and announces the change. */
export function switchUser(id) {
  id = id || null;
  if (id === uid) return;
  const old = dbp;
  uid = id; dbp = null;
  try { id ? localStorage.setItem('inkwell:uid', id) : localStorage.removeItem('inkwell:uid'); } catch { /* ignore */ }
  old?.then((d) => d.close()).catch(() => {});
  emit('user:changed', { uid });
}
const globalDB = () => (gdbp ||= openDB('inkwell-global', 1, { upgrade(db) { db.createObjectStore('meta'); } }));
const visible = (r) => !r || !uid || !r.ownerId || r.ownerId === uid || !!r.sharedBy;
function create(db) {
  for (const s of STORES) {
    const st = db.createObjectStore(s, { keyPath: 'id' });
    st.createIndex('updatedAt', 'updatedAt');
    st.createIndex('dirty', 'dirty');
    if (s === 'notes') { st.createIndex('notebookId', 'notebookId'); }
    if (s === 'assets') { st.createIndex('noteId', 'noteId'); }
  }
  db.createObjectStore('meta');
}
/** the first user to sign in on a device adopts the old single-user 'inkwell' database once */
async function adoptLegacy(db, forUid) {
  try {
    const g = await globalDB();
    if (await g.get('meta', 'legacyAdopted')) return;
    await g.put('meta', forUid, 'legacyAdopted');
    const known = indexedDB.databases ? (await indexedDB.databases()).some((d) => d.name === 'inkwell') : true;
    if (!known) return;
    const legacy = await openDB('inkwell');
    if (legacy.objectStoreNames.contains('notes')) {
      for (const s of STORES) {
        const rows = await legacy.getAll(s);
        const tx = db.transaction(s, 'readwrite');
        for (const r of rows) { r.ownerId = forUid; r.dirty = 1; tx.store.put(r); }
        await tx.done;
      }
      const st = await legacy.get('meta', 'settings'); if (st) await db.put('meta', st, 'settings');
    }
    legacy.close();
  } catch (e) { console.warn('legacy adoption skipped', e); }
}
export function getDB() {
  if (!dbp) {
    const mine = uid;
    dbp = openDB(mine ? 'inkwell-' + mine : 'inkwell-anon', 1, { upgrade: create }).then(async (db) => { if (mine) await adoptLegacy(db, mine); return db; });
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
  if (uid && !rec.ownerId) rec.ownerId = uid;
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
export async function getRecord(store, id) { const r = await (await getDB()).get(store, id); return visible(r) ? r : undefined; }
export async function getAll(store) { return (await (await getDB()).getAll(store)).filter((r) => !r.deleted && visible(r)); }
export async function getAllRaw(store) { return (await getDB()).getAll(store); }
export async function getDirty(store) { return (await getDB()).getAllFromIndex(store, 'dirty', 1); }
export async function softDelete(store, id) {
  const r = await getRecord(store, id);
  if (!r) return;
  r.deleted = true;
  if (store === 'assets') delete r.blob; // keep tombstone small
  return putRecord(store, r);
}
export async function getMeta(k, d) { const v = await (GLOBAL_KEYS.has(k) ? await globalDB() : await getDB()).get('meta', k); return v === undefined ? d : v; }
export async function setMeta(k, v) {
  if (k === 'sync:auth') switchUser(v?.token ? v.user?.id : null);   // sign-in/out moves to that user's database immediately
  await (GLOBAL_KEYS.has(k) ? await globalDB() : await getDB()).put('meta', v, k);
}

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
