// Cloud sync client. Offline-first: every write is local first (db.js marks it dirty, which IS the persistent
// outbox: it lives in IndexedDB and survives reloads). This module pushes dirty records, then pulls remote changes
// (last-write-wins by updatedAt, tombstones, conflicted copies, shared notes). Never blocks the UI.
// Protocol: backend/README.md
import { getDB, getRecord, getDirty, getAllRaw, rawPut, putRecord, getMeta, setMeta, newId } from './db.js';
import { on, emit, toast } from './store.js';
import { getSetting, getSettings, updateSettings } from './settings.js';
import { debounce } from './utils.js';
import * as cx from './crypto.js';
import { HttpError, getBackend } from './backend.js';
import './backends/django.js';
import './backends/none.js';

export { HttpError };

const KINDS = ['notebooks', 'notes', 'assets'];
const PUSH_BATCH = 100;
const PUSH_BYTES = 4 * 1024 * 1024;
const CHUNK = 2 * 1024 * 1024;
const SKEW_IGNORE_MS = 2000;
const LOCAL_ONLY = ['dirty', 'blob', 'sharedBy', 'sharedRole', 'sharedOwnerId'];

let started = false, running = null, rerun = false, timer = null, failures = 0, nextAllowed = 0, offsetMs = 0;
let selfId = null, e2eKey = null, bgDownloading = false, unsubs = [], live = false, cfg = null, lastChange = Date.now();
const failed = new Map();      // "kind:id" -> error text (shown in the queue UI, retried automatically)
const transfers = new Map();   // asset id -> {dir, loaded, total, ctl}
let state = { state: 'idle', lastSync: null, pending: 0, error: null, signedIn: false };

export const getSyncState = () => ({ ...state });
function setState(patch) {
  state = { ...state, ...patch };
  emit('sync:status', { state: state.state, lastSync: state.lastSync, pending: state.pending, error: state.error, signedIn: state.signedIn, failed: failed.size });
}
export function getQueue() {
  return { pending: state.pending, failed: [...failed].map(([k, error]) => ({ key: k, error })), transfers: [...transfers].map(([id, t]) => ({ id, dir: t.dir, loaded: t.loaded, total: t.total })) };
}
const progress = (id, patch) => {
  if (!patch) transfers.delete(id); else transfers.set(id, { ...(transfers.get(id) || {}), ...patch });
  emit('sync:progress', { id, ...(patch || { done: true }) });
};
export function cancelTransfer(id) { transfers.get(id)?.ctl?.abort(); }

// ---------- auth / config ----------
export async function getAuth() { return (await getMeta('sync:auth', null)) || null; }
async function saveAuth(a) { await setMeta('sync:auth', a); setState({ signedIn: !!a?.token }); }
export async function getDeviceId() {
  let id = await getMeta('deviceId', null);
  if (!id) { id = newId(); await setMeta('deviceId', id); }
  return id;
}
const deviceName = () => {
  const ua = navigator.userAgent || '';
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} - ${br}`;
};
const base = (a) => ((a?.serverUrl || '').trim().replace(/\/+$/, ''));

const B = () => getBackend();
/** run an adapter call and track the server clock offset from its `serverTime` */
async function timed(fn) {
  const t0 = Date.now();
  const data = await fn(await B());
  const t1 = Date.now();
  if (data?.serverTime) { const off = data.serverTime - (t0 + t1) / 2; offsetMs = offsetMs ? offsetMs * 0.5 + off * 0.5 : off; }
  return data;
}

/** Authenticated backend-specific call for the UI modules (presence, sharing, admin...). Returns parsed JSON. */
export async function apiCall(path, opts = {}) {
  const auth = await getAuth();
  return (await B()).call(auth, path, opts);
}
export async function getConfig(force = false) {
  if (cfg && !force) return cfg;
  try { cfg = await (await B()).config(await getAuth()); await setMeta('sync:config', cfg); }
  catch { cfg = (await getMeta('sync:config', null)) || { mode: 'internal', registrationOpen: false, features: {} }; }
  return cfg;
}
/** Cached view of the signed-in profile (name, avatar, role) */
export async function getMe() {
  const a = await getAuth();
  return a?.token ? { ...(a.user || {}), serverUrl: a.serverUrl } : null;
}

export async function signIn({ serverUrl = '', email, password, displayName, register = false, code, remember, website = '', elapsedMs, pow }) {
  const auth0 = { serverUrl };
  const be = await B();
  const data = await (register ? be.register : be.login).call(be, auth0, {
    email, password, displayName, code, remember, website, elapsedMs, pow,
    deviceId: await getDeviceId(), deviceName: deviceName(),
  });
  if (data.verificationRequired) return { verificationRequired: true, email: data.email || email };
  const prev = await getAuth();
  const same = prev && base(prev) === base(auth0) && prev.user?.id === data.user.id;
  await saveAuth({ serverUrl, token: data.token, user: data.user, tokenAt: Date.now(), mustChange: !!data.mustChangePassword });
  if (!same) { await setMeta('sync:cursor', '0'); await markAllDirty(); }
  if (data.mustChangePassword) emit('auth:must-change', {});
  emit('auth:changed', { user: data.user });
  scheduleSoon(0, true);
  return { user: data.user, mustChangePassword: !!data.mustChangePassword };
}

export async function signOut() {
  const a = await getAuth();
  if (a?.token) { try { await (await B()).logout(a); } catch { /* offline: token just expires */ } }
  await saveAuth(null);
  await setMeta('sync:cursor', '0');
  await setMeta('sync:lastSync', null);
  setState({ state: 'idle', error: null, lastSync: null });
  emit('auth:changed', { user: null });
  await refreshPending();
}
export async function setServerUrl(url) { const a = (await getAuth()) || {}; await saveAuth({ ...a, serverUrl: (url || '').trim() }); }
export const getAccountInfo = async () => (await B()).me(await getAuth()).then(async (d) => { const a = await getAuth(); if (a && d?.user) await saveAuth({ ...a, user: d.user }); return d; });
export async function changePassword(oldPassword, newPassword) {
  await (await B()).changePassword(await getAuth(), oldPassword, newPassword);
  const a = await getAuth(); if (a) await saveAuth({ ...a, mustChange: false });
}
export async function deleteAccount(password) {
  await (await B()).deleteAccount(await getAuth(), password);
  await saveAuth(null); await setMeta('sync:cursor', '0');
  setState({ state: 'idle', lastSync: null, error: null });
  emit('auth:changed', { user: null });
}
export const listDevices = async () => (await B()).listDevices(await getAuth());
export const revokeDevice = async (id) => (await B()).revokeDevice(await getAuth(), id);
export const checkServer = async (url) => (await B()).health(url);
export const updateProfile = async (patch) => (await B()).updateProfile(await getAuth(), patch).then(getAccountInfoCache);
async function getAccountInfoCache(d) { const a = await getAuth(); if (a && d?.user) await saveAuth({ ...a, user: d.user }); return d; }
export async function uploadAvatar(blob) {
  await (await B()).uploadAvatar(await getAuth(), blob);
  return getAccountInfo();
}
/** Fetch an avatar as an object URL (requires auth header, so it cannot be a plain <img src>). */
const avatarCache = new Map();
export async function avatarUrl(id) {
  if (!id) return null;
  if (avatarCache.has(id)) return avatarCache.get(id);
  try {
    const blob = await (await B()).fetchBlob(await getAuth(), '/api/avatar/' + encodeURIComponent(id));
    if (!blob) return null;
    const u = URL.createObjectURL(blob); avatarCache.set(id, u); return u;
  } catch { return null; }
}

async function markAllDirty() {
  const db = await getDB();
  for (const s of KINDS) {
    const tx = db.transaction(s, 'readwrite');
    for (let c = await tx.store.openCursor(); c; c = await c.continue()) {
      const r = c.value;
      if (!r.dirty && !r.sharedOwnerId) { r.dirty = 1; await c.update(r); }
    }
    await tx.done;
  }
}

// ---------- end-to-end encryption ----------
const e2eSalt = (a) => 'inkwell-e2e:' + (a?.user?.id || '');
export async function isE2EEnabled() { return !!(await getMeta('sync:e2e', null))?.enabled; }
async function loadKey() {
  if (e2eKey) return e2eKey;
  const m = await getMeta('sync:e2e', null);
  if (m?.enabled && m.jwk) e2eKey = await cx.importKey(m.jwk);
  return e2eKey;
}
/** Turn on E2E: everything is re-encrypted and re-uploaded. A lost passphrase cannot be recovered. */
export async function enableE2E(passphrase) {
  if (!cx.cryptoAvailable()) throw new Error('Encryption is not available (needs HTTPS or localhost).');
  if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  e2eKey = await cx.deriveKey(passphrase, e2eSalt(await getAuth()), { extractable: true });
  await setMeta('sync:e2e', { enabled: true, jwk: await cx.exportKey(e2eKey) });
  await markAllDirty();
  scheduleSoon(0, true);
}
export const unlockE2E = enableE2E;
export async function disableE2E() { e2eKey = null; await setMeta('sync:e2e', { enabled: false }); await markAllDirty(); scheduleSoon(0, true); }

// ---------- helpers ----------
const stripLocal = (r) => { const c = { ...r }; for (const k of LOCAL_ONLY) delete c[k]; return c; };
const comparable = (r) => { const c = stripLocal(r); delete c.updatedAt; delete c.preview; delete c.deleted; return JSON.stringify(c); };
const unmetered = () => { if (getSetting('sync.wifiOnlyLarge') === false) return true; const c = navigator.connection; return !c || (!c.saveData && c.type !== 'cellular'); };

export async function countPending() { let n = 0; for (const s of KINDS) n += (await getDirty(s)).length; return n; }
async function refreshPending() { setState({ pending: await countPending() }); }
const refreshPendingSoon = debounce(() => refreshPending().catch(() => {}), 250);

// ---------- push ----------
async function wireRecord(kind, rec, key, uploaded) {
  const plain = stripLocal(rec);
  const adj = Math.abs(offsetMs) > SKEW_IGNORE_MS ? Math.round(rec.updatedAt + offsetMs) : rec.updatedAt;
  let data = plain;
  if (key && !rec.sharedOwnerId) { // shared notes stay readable for collaborators
    if (kind === 'assets' && uploaded) plain.blobEnc = true;
    data = { enc: 1, ct: await cx.encryptJSON(plain, key) };
  }
  const w = { kind, id: rec.id, updatedAt: adj, deleted: !!rec.deleted, data };
  if (rec.sharedOwnerId) w.ownerId = rec.sharedOwnerId;
  return w;
}


async function uploadBlob(auth, rec, key) {
  const enc = !!key && !rec.sharedOwnerId;
  let bytes = new Uint8Array(await rec.blob.arrayBuffer());
  let type = rec.mime || rec.blob.type || 'application/octet-stream';
  const headers = { 'Content-Type': type };
  if (enc) { bytes = await cx.encryptBytes(bytes, key); headers['Content-Type'] = 'application/octet-stream'; headers['X-Encrypted'] = '1'; }
  if (rec.noteId) headers['X-Note-Id'] = rec.noteId;
  const total = bytes.length, ctl = new AbortController();
  progress(rec.id, { dir: 'up', loaded: 0, total, ctl });
  try { await (await B()).uploadAsset(auth, rec, bytes, { headers, signal: ctl.signal, onProgress: (n) => progress(rec.id, { loaded: n }) }); }
  finally { progress(rec.id, null); }
}

async function flushBatch(auth, key, batch, snap) {
  const data = await timed(async (be) => be.push(auth, { deviceId: await getDeviceId(), records: batch }));
  for (const acc of data.accepted || []) {
    const s = snap.get(acc.kind + ':' + acc.id);
    const cur = await getRecord(acc.kind, acc.id);
    failed.delete(acc.kind + ':' + acc.id);
    if (!cur || !s) continue;
    if (cur.updatedAt === s.updatedAt) { // unchanged while the request was in flight
      const next = { ...cur, dirty: 0 };
      if (Math.abs(offsetMs) > SKEW_IGNORE_MS && acc.updatedAt) next.updatedAt = acc.updatedAt;
      await rawPut(acc.kind, next, { silent: true });
    }
  }
  for (const c of data.conflicts || []) await applyRemote(c, key, { fromConflict: true });
  for (const r of data.rejected || []) failed.set((r.kind || '?') + ':' + (r.id || ''), r.error || 'rejected');
}

async function pushAll(auth, key) {
  const dirty = {};
  for (const kind of KINDS) dirty[kind] = (await getDirty(kind)).map((r) => ({ ...r }));
  const content = [...dirty.notebooks.map((rec) => ({ kind: 'notebooks', rec })), ...dirty.notes.map((rec) => ({ kind: 'notes', rec }))];
  // phase 1: notebooks and notes (small, high priority) so text is safe in the cloud before big files go
  await pushItems(auth, key, content);
  // phase 2: assets, smallest first
  const assets = dirty.assets.sort((a, b) => (a.blob?.size || 0) - (b.blob?.size || 0));
  await pushItems(auth, key, assets.map((rec) => ({ kind: 'assets', rec })));
}

async function pushItems(auth, key, items) {
  let batch = [], snap = new Map(), bytes = 0;
  const flush = async () => { if (batch.length) { const b = batch, s = snap; batch = []; snap = new Map(); bytes = 0; await flushBatch(auth, key, b, s); } };
  for (const { kind, rec } of items) {
    let uploaded = false;
    if (kind === 'assets' && !rec.deleted) {
      if (!rec.blob) continue; // metadata-only copy of a remote asset: nothing to push
      if (rec.blob.size > 5 * 1024 * 1024 && !unmetered()) continue; // large file waits for Wi-Fi (setting)
      try { await uploadBlob(auth, rec, key); uploaded = true; failed.delete('assets:' + rec.id); }
      catch (e) {
        if (e instanceof HttpError && [413, 415, 403, 404].includes(e.status)) { failed.set('assets:' + rec.id, e.message); continue; }
        if (e?.name === 'AbortError') { failed.set('assets:' + rec.id, 'cancelled'); continue; }
        throw e;
      }
    }
    const w = await wireRecord(kind, rec, key, uploaded);
    const size = JSON.stringify(w).length;
    if (batch.length && (batch.length >= PUSH_BATCH || bytes + size > PUSH_BYTES)) await flush();
    batch.push(w); snap.set(kind + ':' + rec.id, rec); bytes += size;
  }
  await flush();
}

// ---------- pull / apply ----------
const isForeign = (r) => !!r.ownerId && (selfId ? r.ownerId !== selfId : !!r.role);
async function decodeRemote(r, key) {
  let d = r.data || {};
  if (d.enc) {
    if (isForeign(r)) return null; // someone else's encrypted data cannot be read by us
    if (!key) throw new HttpError(0, 'Encrypted data found. Enter your encryption passphrase in Sync settings.', { code: 'needs-passphrase' });
    try { d = await cx.decryptJSON(d.ct, key); }
    catch { throw new HttpError(0, 'Could not decrypt synced data: wrong passphrase?', { code: 'bad-passphrase' }); }
  }
  return d;
}

async function applyRemote(r, key, { fromConflict = false } = {}) {
  const kind = r.kind;
  if (!KINDS.includes(kind)) return false;
  const data = await decodeRemote(r, key);
  if (!data) return false;
  const local = await getRecord(kind, r.id);
  const force = !!r.force;
  if (local && !force) {
    if (local.updatedAt > r.updatedAt) return false; // local is newer: it wins and gets pushed
    if (local.updatedAt === r.updatedAt && !!local.deleted === !!r.deleted && !fromConflict) return false;
    // both sides edited: keep the losing local note as a conflicted copy
    if (kind === 'notes' && getSetting('sync.conflict') !== 'newest' && local.dirty && !local.deleted && !r.deleted && comparable(local) !== comparable({ ...data, id: r.id })) {
      await putRecord('notes', { ...stripLocal(local), id: newId(), title: (local.title || 'Untitled') + ' (conflict)', createdAt: Date.now() });
    }
  }
  const rec = { ...data, id: r.id, updatedAt: r.updatedAt, deleted: !!r.deleted, dirty: 0 };
  for (const k of LOCAL_ONLY) delete rec[k];
  if (!data.blobEnc) delete rec.blobEnc;
  if (isForeign(r)) { rec.sharedOwnerId = r.ownerId; rec.sharedBy = r.owner; rec.sharedRole = r.role === 'editor' ? 'write' : 'read'; }
  else if (local?.sharedOwnerId) { rec.sharedOwnerId = local.sharedOwnerId; rec.sharedBy = local.sharedBy; rec.sharedRole = local.sharedRole; }
  if (kind === 'assets') { if (r.deleted) delete rec.blob; else if (local?.blob) rec.blob = local.blob; }
  await rawPut(kind, rec, { silent: true });
  lastChange = Date.now();
  if (isForeign(r) && !local && kind === 'notes' && !r.deleted && getSetting('notif.inApp') !== false) toast(`${r.owner || 'Someone'} shared "${rec.title || 'Untitled'}" with you`);
  return kind;
}

/** Drop local copies of things that are no longer shared with us (revoked / expired / left). */
async function pruneRevoked(list) {
  const direct = new Set(list.map((s) => s.kind + ':' + s.id));
  const nbs = new Set(list.filter((s) => s.kind === 'notebooks').map((s) => s.id));
  const db = await getDB();
  const notes = await getAllRaw('notes'), covered = new Set();
  let n = 0;
  for (const nt of notes) {
    if (!nt.sharedOwnerId) continue;
    if (direct.has('notes:' + nt.id) || (nt.notebookId && nbs.has(nt.notebookId))) covered.add(nt.id);
    else { await db.delete('notes', nt.id); n++; }
  }
  for (const nb of await getAllRaw('notebooks')) if (nb.sharedOwnerId && !direct.has('notebooks:' + nb.id)) { await db.delete('notebooks', nb.id); n++; }
  for (const a of await getAllRaw('assets')) if (a.sharedOwnerId && !covered.has(a.noteId)) { await db.delete('assets', a.id); n++; }
  return n;
}

async function pullAll(auth, key, { wait = false } = {}) {
  let cursor = (await getMeta('sync:cursor', '0')) || '0';
  if (typeof cursor === 'number') cursor = '0';
  const touched = new Set();
  for (let guard = 0; guard < 500; guard++) {
    const data = await timed((be) => be.pull(auth, { since: cursor, limit: 200, wait: wait && guard === 0 }));
    if (!data) break; // 304: nothing new
    for (const r of data.records) { const k = await applyRemote(r, key); if (k) touched.add(k); }
    cursor = data.cursor;
    await setMeta('sync:cursor', cursor);
    if (!data.hasMore) {
      if (data.shared && (await pruneRevoked(data.shared))) { touched.add('notes'); touched.add('notebooks'); }
      break;
    }
  }
  if (touched.has('notebooks')) emit('notebooks:changed', { remote: true, bulk: true });
  if (touched.size) emit('notes:changed', { remote: true, bulk: true });
}

// ---------- assets (lazy blobs, ranged + resumable download) ----------
export async function ensureAsset(id) {
  const rec = await getRecord('assets', id);
  if (rec?.blob || rec?.deleted) { if (rec?.blob) touchAsset(rec); return rec || null; }
  const auth = await getAuth();
  if (!auth?.token || !navigator.onLine || transfers.has(id)) return rec || null;
  const key = await loadKey();
  const be = await B();
  const ctl = new AbortController();
  progress(id, { dir: 'down', loaded: 0, total: rec?.size || 0, ctl });
  const parts = [];
  let loaded = 0, total = 0, type = 'application/octet-stream';
  try {
    for (let tries = 0; ; ) {
      try {
        const r = await be.downloadAsset(auth, rec || { id }, { start: loaded, end: loaded + CHUNK - 1, signal: ctl.signal });
        if (!r) return rec || null;
        total = r.total; type = r.type || type;
        parts.push(r.bytes); loaded += r.bytes.length; tries = 0;
        progress(id, { loaded, total });
        if (r.status === 200 || loaded >= total || !r.bytes.length) break;
      } catch (e) { // resume from the bytes we already have
        if (e?.name === 'AbortError' || ++tries > 4 || !navigator.onLine) throw e;
        await new Promise((r) => setTimeout(r, 800 * 2 ** tries));
      }
    }
  } catch (e) { if (e?.name === 'AbortError') return rec || null; failed.set('assets:' + id, e.message || 'download failed'); return rec || null; }
  finally { progress(id, null); }
  let buf = new Uint8Array(loaded);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  if (rec?.blobEnc) { if (!key) return rec; try { buf = await cx.decryptBytes(buf, key); } catch { failed.set('assets:' + id, 'integrity check failed'); return rec; } }
  failed.delete('assets:' + id);
  const fresh = (await getRecord('assets', id)) || rec || { id };
  const next = { ...fresh, blob: new Blob([buf], { type: fresh.mime || type }), lastAccess: Date.now(), dirty: fresh.dirty ? 1 : 0 };
  await rawPut('assets', next, { silent: true });
  emit('notes:changed', { remote: true, asset: id });
  return next;
}
const touchAsset = debounce(() => {}, 1000);

async function backgroundDownloads() {
  if (bgDownloading || !unmetered()) return;
  bgDownloading = true;
  try {
    const missing = (await getAllRaw('assets')).filter((a) => !a.deleted && !a.blob).sort((a, b) => (a.size || 0) - (b.size || 0));
    for (const a of missing) {
      if (!navigator.onLine || !unmetered() || !(await getAuth())?.token) break;
      if (failed.has('assets:' + a.id)) continue;
      await ensureAsset(a.id).catch(() => {});
    }
  } finally { bgDownloading = false; }
}

/** Free space: drop cached blobs that are safely in the cloud (least recently used first). They re-download on demand. */
export async function pruneBlobs({ force = false } = {}) {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota || (!force && est.usage / est.quota < 0.8)) return 0;
    if (!(await getAuth())?.token) return 0;
    const db = await getDB();
    const list = (await getAllRaw('assets')).filter((a) => a.blob && !a.dirty && !a.deleted).sort((a, b) => (a.lastAccess || a.updatedAt) - (b.lastAccess || b.updatedAt));
    let freed = 0;
    for (const a of list) {
      const { blob, ...rest } = a;
      await db.put('assets', { ...rest, size: rest.size || blob.size });
      freed += blob.size;
      const e2 = await navigator.storage.estimate();
      if (e2.usage / e2.quota < 0.65) break;
    }
    return freed;
  } catch { return 0; }
}

// ---------- account settings follow the account ----------
let applyingRemote = false;
async function syncAccountSettings(auth) {
  const dirtyAt = await getMeta('sync:settingsDirty', 0);
  if (dirtyAt) {
    const { sync: _local, ...rest } = getSettings();
    const data = await (await B()).putSettings(auth, { settings: rest, updatedAt: dirtyAt });
    if (!data.conflict) { await setMeta('sync:settingsDirty', 0); await setMeta('sync:settingsAt', data.updatedAt); return; }
  }
  const data = await (await B()).getSettings(auth);
  if (data.settings && data.updatedAt > ((await getMeta('sync:settingsAt', 0)) || 0)) {
    applyingRemote = true;
    try { await updateSettings({ ...data.settings, sync: getSettings().sync }); } finally { applyingRemote = false; }
    await setMeta('sync:settingsAt', data.updatedAt); await setMeta('sync:settingsDirty', 0);
  }
}

// ---------- orchestration ----------
const backoffDelay = () => Math.min(5 * 60000, 5000 * 2 ** Math.min(failures, 6)) * (0.75 + Math.random() * 0.5);

async function cycle() {
  const auth = await getAuth();
  if (!auth?.token) { setState({ state: 'idle', error: null, signedIn: false }); await refreshPending(); return; }
  selfId = auth.user?.id || null;
  setState({ signedIn: true });
  if (!navigator.onLine) { setState({ state: 'offline' }); await refreshPending(); return; }
  if (auth.mustChange) { setState({ state: 'error', error: 'Please change your temporary password to continue syncing.' }); return; }
  setState({ state: 'syncing', error: null });
  try {
    const key = await loadKey();
    await pushAll(auth, key);
    await pullAll(auth, key, { wait: live && !!cfg?.features?.longPoll });
    await syncAccountSettings(auth).catch(() => {});
    failures = 0; nextAllowed = 0;
    const lastSync = Date.now();
    await setMeta('sync:lastSync', lastSync);
    await refreshPending();
    setState({ state: failed.size ? 'error' : 'idle', lastSync, error: failed.size ? `${failed.size} item(s) could not sync` : null });
    if (Date.now() - (auth.tokenAt || 0) > 30 * 86400000) rotateToken(auth).catch(() => {});
    backgroundDownloads().catch(() => {});
    pruneBlobs().catch(() => {});
  } catch (e) {
    failures++;
    nextAllowed = Date.now() + backoffDelay();
    await refreshPending().catch(() => {});
    if (e instanceof HttpError && e.code === 'password-change-required') { const a = await getAuth(); await saveAuth({ ...a, mustChange: true }); emit('auth:must-change', {}); setState({ state: 'error', error: 'Please change your temporary password to continue syncing.' }); }
    else if (e instanceof HttpError && e.status === 401) setState({ state: 'error', error: 'Signed out by the server. Please sign in again.' });
    else if (e instanceof HttpError) setState({ state: 'error', error: e.message });
    else if (!navigator.onLine || e?.name === 'TypeError' || e?.name === 'AbortError') setState({ state: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? 'Cannot reach the server' : null });
    else { console.warn('sync failed', e); setState({ state: 'error', error: e?.message || 'Sync failed' }); }
    armTimer(nextAllowed - Date.now());
  }
}

async function rotateToken(auth) {
  const data = await (await B()).refresh(auth);
  const cur = await getAuth();
  if (cur?.token === auth.token) await saveAuth({ ...cur, token: data.token, tokenAt: Date.now() });
}

/** Run a sync now (concurrent calls share one run, with one follow-up if requested mid-run). */
export function syncNow() {
  if (running) { rerun = true; return running; }
  running = (async () => {
    try { do { rerun = false; await cycle(); } while (rerun && failures === 0); }
    finally { running = null; armTimer(); }
  })();
  return running;
}

/** Retry everything that failed (resets backoff). */
export function retryFailed() { failed.clear(); failures = 0; nextAllowed = 0; return syncNow(); }

/** Adaptive polling: ~2.5s while a shared note is open, 30s normally, slower when idle or hidden. */
export function setLiveMode(on) { if (live !== !!on) { live = !!on; armTimer(); if (live) syncNow().catch(() => {}); } }
function armTimer(ms) {
  clearTimeout(timer);
  if (!started) return;
  const visible = document.visibilityState === 'visible';
  const idle = Date.now() - lastChange > 120000;
  const iv = getSetting('sync.interval');
  if (iv === 0 && ms == null && !live) return; // "manual only"
  const base = (typeof iv === 'number' && iv > 0 ? iv : 30) * 1000;
  const regular = live && visible ? (cfg?.features?.longPoll ? 500 : 2500) : visible ? (idle ? Math.max(base, 60000) : base) : Math.max(base, 120000);
  timer = setTimeout(() => syncNow().catch(() => {}), Math.max(500, ms ?? regular));
}

const debounced = debounce(() => { if (getSetting('sync.interval') !== 0 && Date.now() >= nextAllowed) syncNow().catch(() => {}); }, 3000);
function scheduleSoon(ms = 3000, force = false) {
  if (force) { failures = 0; nextAllowed = 0; }
  if (ms === 0) syncNow().catch(() => {}); else debounced();
}

function registerBackgroundSync() { if (getSetting('sync.background') === false) return; navigator.serviceWorker?.ready?.then((reg) => reg.sync?.register('inkwell-sync')).catch(() => {}); }

async function updateLive() {
  const m = /^#\/note\/([^?/]+)/.exec(location.hash);
  if (!m) return setLiveMode(false);
  const n = await getRecord('notes', decodeURIComponent(m[1]));
  setLiveMode(!!(n && (n.sharedOwnerId || (n.shares && n.shares.length) || n.publicLink)));
}

export async function startSync() {
  if (started) return;
  started = true;
  offsetMs = (await getMeta('sync:offset', 0)) || 0;
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict our data
  const auth = await getAuth();
  getConfig().catch(() => {});
  setState({ signedIn: !!auth?.token, lastSync: (await getMeta('sync:lastSync', null)) || null });
  await refreshPending();

  const onLocal = (e) => {
    if (e?.remote) return;
    lastChange = Date.now();
    refreshPendingSoon();
    getAuth().then((a) => { if (a?.token) { debounced(); if (!navigator.onLine) registerBackgroundSync(); } });
  };
  unsubs = [on('notes:changed', onLocal), on('notebooks:changed', onLocal),
    on('settings:changed', () => { if (!applyingRemote) { setMeta('sync:settingsDirty', Date.now()).then(() => getAuth()).then((a) => { if (a?.token) debounced(); }); } })];
  const onOnline = () => { failures = 0; nextAllowed = 0; syncNow().catch(() => {}); }; // flush the outbox immediately, then pull
  const onOffline = () => getAuth().then((a) => { if (a?.token) setState({ state: 'offline' }); });
  const onVis = () => { if (document.visibilityState === 'visible' && Date.now() >= nextAllowed) syncNow().catch(() => {}); armTimer(); };
  const onHide = () => { setMeta('sync:offset', offsetMs).catch(() => {}); };
  const onHash = () => updateLive().catch(() => {});
  window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVis); window.addEventListener('pagehide', onHide); window.addEventListener('hashchange', onHash);
  unsubs.push(() => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); window.removeEventListener('hashchange', onHash); });
  updateLive().catch(() => {});

  if (auth?.token) syncNow().catch(() => {}); else armTimer();
}

export function stopSync() {
  started = false;
  clearTimeout(timer);
  debounced.cancel();
  unsubs.forEach((u) => u());
  unsubs = [];
}
