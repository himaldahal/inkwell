// Cloud sync client. Offline-first: every write is local first (db.js marks it dirty);
// this module pushes dirty records, then pulls remote changes (last-write-wins by updatedAt,
// tombstones, conflicted copies for diverged notes). Nothing here ever blocks the UI.
// Protocol: backend/README.md
import { getDB, getRecord, getDirty, getAllRaw, rawPut, putRecord, getMeta, setMeta, newId } from './db.js';
import { on, emit } from './store.js';
import { debounce } from './utils.js';
import * as cx from './crypto.js';

const KINDS = ['notebooks', 'notes', 'assets'];
const PUSH_BATCH = 100;
const PUSH_BYTES = 4 * 1024 * 1024;
const SKEW_IGNORE_MS = 2000;

let started = false;
let running = null;
let rerun = false;
let timer = null;
let failures = 0;
let nextAllowed = 0;
let offsetMs = 0;
let e2eKey = null;
let bgDownloading = false;
let unsubs = [];
let state = { state: 'idle', lastSync: null, pending: 0, error: null, signedIn: false };

export const getSyncState = () => ({ ...state });
function setState(patch) {
  state = { ...state, ...patch };
  emit('sync:status', { state: state.state, lastSync: state.lastSync, pending: state.pending, error: state.error, signedIn: state.signedIn });
}

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

class HttpError extends Error {
  constructor(status, msg, body) { super(msg || 'HTTP ' + status); this.status = status; this.body = body; }
}

async function http(auth, path, { method = 'GET', json, body, headers = {}, timeout = 30000, noAuth = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const h = { ...headers };
  if (auth?.token && !noAuth) h.Authorization = 'Bearer ' + auth.token;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(base(auth) + path, { method, headers: h, body, signal: ctl.signal, credentials: 'omit' });
  } finally { clearTimeout(t); }
  const t1 = Date.now();
  if (res.status === 304) return { res, data: null };
  let data = null;
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('json')) { try { data = await res.json(); } catch { /* ignore */ } }
  if (!res.ok) throw new HttpError(res.status, data?.error || res.statusText, data);
  if (data?.serverTime) {
    const off = data.serverTime - (t0 + t1) / 2;
    offsetMs = offsetMs ? offsetMs * 0.5 + off * 0.5 : off;
  }
  return { res, data };
}

export async function signIn({ serverUrl = '', username, password, email, register = false }) {
  const auth0 = { serverUrl };
  const { data } = await http(auth0, register ? '/api/auth/register' : '/api/auth/login', {
    method: 'POST', noAuth: true,
    json: { username, password, email, deviceId: await getDeviceId(), deviceName: deviceName() },
  });
  const prev = await getAuth();
  const same = prev && base(prev) === base(auth0) && prev.username === data.user.username;
  await saveAuth({ serverUrl, token: data.token, username: data.user.username, tokenAt: Date.now() });
  if (!same) {
    await setMeta('sync:cursor', 0);
    await markAllDirty(); // upload everything that exists locally to the new account
  }
  scheduleSoon(0, true);
  return data.user;
}

export async function signOut({ keepData = true } = {}) {
  const a = await getAuth();
  if (a?.token) { try { await http(a, '/api/auth/logout', { method: 'POST', timeout: 8000 }); } catch { /* offline: token just expires */ } }
  await saveAuth(null);
  await setMeta('sync:cursor', 0);
  await setMeta('sync:lastSync', null);
  setState({ state: 'idle', error: null, lastSync: null });
  await refreshPending();
  return keepData;
}

export async function setServerUrl(url) {
  const a = (await getAuth()) || {};
  await saveAuth({ ...a, serverUrl: (url || '').trim() });
}
export async function getAccountInfo() {
  const a = await getAuth();
  if (!a?.token) return null;
  return (await http(a, '/api/auth/me')).data;
}
export async function changePassword(oldPassword, newPassword) {
  await http(await getAuth(), '/api/auth/password', { method: 'POST', json: { oldPassword, newPassword } });
}
export async function deleteAccount(password) {
  const a = await getAuth();
  await http(a, '/api/auth/delete', { method: 'POST', json: { password } });
  await saveAuth(null);
  await setMeta('sync:cursor', 0);
  setState({ state: 'idle', lastSync: null, error: null });
}
export async function listDevices() { return (await http(await getAuth(), '/api/devices')).data.devices; }
export async function revokeDevice(id) { await http(await getAuth(), '/api/devices/' + encodeURIComponent(id), { method: 'DELETE' }); }
export async function checkServer(url) {
  const { data } = await http({ serverUrl: url }, '/api/health', { noAuth: true, timeout: 8000 });
  return data;
}

async function markAllDirty() {
  const db = await getDB();
  for (const s of KINDS) {
    const tx = db.transaction(s, 'readwrite');
    for (let c = await tx.store.openCursor(); c; c = await c.continue()) {
      const r = c.value;
      if (!r.dirty) { r.dirty = 1; await c.update(r); }
    }
    await tx.done;
  }
}

// ---------- end-to-end encryption ----------
const e2eSalt = (a) => 'inkwell-e2e:' + (a?.username || '');
export async function isE2EEnabled() { return !!(await getMeta('sync:e2e', null))?.enabled; }
async function loadKey() {
  if (e2eKey) return e2eKey;
  const m = await getMeta('sync:e2e', null);
  if (m?.enabled && m.jwk) e2eKey = await cx.importKey(m.jwk);
  return e2eKey;
}
/** Turn on E2E: all records are re-encrypted and re-uploaded. A lost passphrase cannot be recovered. */
export async function enableE2E(passphrase) {
  if (!cx.cryptoAvailable()) throw new Error('Encryption is not available (needs HTTPS or localhost).');
  if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  const a = await getAuth();
  e2eKey = await cx.deriveKey(passphrase, e2eSalt(a), { extractable: true });
  await setMeta('sync:e2e', { enabled: true, jwk: await cx.exportKey(e2eKey) });
  await markAllDirty();
  scheduleSoon(0, true);
}
/** Unlock on another device (same passphrase; the key is derived deterministically per account). */
export const unlockE2E = enableE2E;
export async function disableE2E() {
  e2eKey = null;
  await setMeta('sync:e2e', { enabled: false });
  await markAllDirty();
  scheduleSoon(0, true);
}

// ---------- helpers ----------
const stripLocal = (r) => { const c = { ...r }; delete c.dirty; delete c.blob; return c; };
const comparable = (r) => { const c = stripLocal(r); delete c.updatedAt; delete c.preview; delete c.deleted; return JSON.stringify(c); };
const unmetered = () => {
  const c = navigator.connection;
  if (!c) return true;
  return !c.saveData && c.type !== 'cellular';
};

export async function countPending() {
  let n = 0;
  for (const s of KINDS) n += (await getDirty(s)).length;
  return n;
}
async function refreshPending() { setState({ pending: await countPending() }); }
const refreshPendingSoon = debounce(() => refreshPending().catch(() => {}), 250);

// ---------- push ----------
async function wireRecord(kind, rec, key, uploaded) {
  const plain = stripLocal(rec);
  const adj = Math.abs(offsetMs) > SKEW_IGNORE_MS ? Math.round(rec.updatedAt + offsetMs) : rec.updatedAt;
  let data = plain;
  if (key) {
    if (kind === 'assets' && uploaded) plain.blobEnc = true;
    data = { enc: 1, ct: await cx.encryptJSON(plain, key) };
  }
  return { kind, id: rec.id, updatedAt: adj, deleted: !!rec.deleted, data };
}

async function uploadBlob(auth, rec, key) {
  let bytes = new Uint8Array(await rec.blob.arrayBuffer());
  let type = rec.mime || rec.blob.type || 'application/octet-stream';
  if (key) { bytes = await cx.encryptBytes(bytes, key); type = 'application/octet-stream'; }
  await http(auth, '/api/assets/' + encodeURIComponent(rec.id), { method: 'PUT', body: bytes, headers: { 'Content-Type': type }, timeout: 180000 });
}

async function pushAll(auth, key) {
  const items = [];
  for (const kind of KINDS) for (const rec of await getDirty(kind)) items.push({ kind, rec: { ...rec } });
  if (!items.length) return;
  items.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  let batch = [], snap = new Map(), bytes = 0, firstErr = null;
  const flush = async () => {
    if (!batch.length) return;
    const { data } = await http(auth, '/api/sync/push', { method: 'POST', json: { deviceId: await getDeviceId(), records: batch }, timeout: 60000 });
    for (const acc of data.accepted || []) {
      const s = snap.get(acc.kind + ':' + acc.id);
      const cur = await getRecord(acc.kind, acc.id);
      if (!cur || !s) continue;
      if (cur.updatedAt === s.updatedAt) { // unchanged while the request was in flight
        const next = { ...cur, dirty: 0 };
        if (Math.abs(offsetMs) > SKEW_IGNORE_MS && acc.updatedAt) next.updatedAt = acc.updatedAt;
        await rawPut(acc.kind, next, { silent: true });
      }
    }
    for (const c of data.conflicts || []) await applyRemote(c, key, { fromConflict: true });
    if ((data.rejected || []).length) firstErr = firstErr || data.rejected[0].error;
    batch = []; snap = new Map(); bytes = 0;
  };
  for (const { kind, rec } of items) {
    let uploaded = false;
    if (kind === 'assets' && !rec.deleted && rec.blob) {
      try { await uploadBlob(auth, rec, key); uploaded = true; }
      catch (e) { if (e instanceof HttpError && e.status === 413) { firstErr = firstErr || e.message; continue; } throw e; }
    } else if (kind === 'assets' && !rec.deleted && !rec.blob) {
      continue; // metadata-only copy of a remote asset that was never downloaded: nothing to push
    }
    const w = await wireRecord(kind, rec, key, uploaded);
    const size = JSON.stringify(w).length;
    if (batch.length && (batch.length >= PUSH_BATCH || bytes + size > PUSH_BYTES)) await flush();
    batch.push(w); snap.set(kind + ':' + rec.id, rec); bytes += size;
  }
  await flush();
  if (firstErr) throw new HttpError(413, firstErr);
}

// ---------- pull / apply ----------
async function decodeRemote(r, key) {
  let d = r.data || {};
  if (d.enc) {
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
  const local = await getRecord(kind, r.id);
  const remoteTs = r.updatedAt;
  if (local) {
    if (local.updatedAt > remoteTs && !fromConflict) return false; // local is newer: it wins and gets pushed
    if (local.updatedAt === remoteTs && !!local.deleted === !!r.deleted && !fromConflict) return false;
    if (fromConflict && local.dirty && local.updatedAt > remoteTs) return false;
    // both sides edited: keep the losing local note as a conflicted copy
    if (kind === 'notes' && local.dirty && !local.deleted && !r.deleted && comparable(local) !== comparable({ ...data, id: r.id })) {
      const copy = { ...stripLocal(local), id: newId(), title: (local.title || 'Untitled') + ' (conflict)', createdAt: Date.now() };
      await putRecord('notes', copy);
    }
  }
  const rec = { ...data, id: r.id, updatedAt: remoteTs, deleted: !!r.deleted, dirty: 0 };
  delete rec.blobEnc;
  if (data.blobEnc) rec.blobEnc = true;
  if (kind === 'assets') {
    if (r.deleted) delete rec.blob;
    else if (local?.blob) rec.blob = local.blob;
  }
  await rawPut(kind, rec, { silent: true });
  return kind;
}

async function pullAll(auth, key) {
  let cursor = (await getMeta('sync:cursor', 0)) || 0;
  const touched = new Set();
  for (let guard = 0; guard < 500; guard++) {
    const { data } = await http(auth, `/api/sync/pull?since=${cursor}&limit=200`, { timeout: 60000 });
    if (!data) break; // 304: nothing new
    for (const r of data.records) { const k = await applyRemote(r, key); if (k) touched.add(k); }
    cursor = data.cursor;
    await setMeta('sync:cursor', cursor);
    if (!data.hasMore) break;
  }
  if (touched.has('notebooks')) emit('notebooks:changed', { remote: true, bulk: true });
  if (touched.size) emit('notes:changed', { remote: true, bulk: true });
}

// ---------- assets (lazy blobs) ----------
/** Make sure an asset's blob is stored locally (download on demand). Resolves to the asset record or null. */
export async function ensureAsset(id) {
  const rec = await getRecord('assets', id);
  if (rec?.blob || rec?.deleted) return rec || null;
  const auth = await getAuth();
  if (!auth?.token || !navigator.onLine) return rec || null;
  const key = await loadKey();
  const res = await rawFetchAsset(auth, id);
  if (!res) return rec || null;
  let buf = new Uint8Array(await res.arrayBuffer());
  if (rec?.blobEnc) {
    if (!key) return rec;
    buf = await cx.decryptBytes(buf, key);
  }
  const fresh = (await getRecord('assets', id)) || rec || { id };
  const next = { ...fresh, blob: new Blob([buf], { type: fresh.mime || 'application/octet-stream' }), dirty: fresh.dirty ? 1 : 0 };
  await rawPut('assets', next, { silent: true });
  emit('notes:changed', { remote: true, asset: id });
  return next;
}
async function rawFetchAsset(auth, id) {
  const res = await fetch(base(auth) + '/api/assets/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + auth.token }, credentials: 'omit' });
  return res.ok ? res : null;
}

async function backgroundDownloads() {
  if (bgDownloading || !unmetered()) return;
  bgDownloading = true;
  try {
    for (const a of await getAllRaw('assets')) {
      if (a.deleted || a.blob) continue;
      if (!navigator.onLine || !unmetered() || !(await getAuth())?.token) break;
      try { await ensureAsset(a.id); } catch { break; }
    }
  } finally { bgDownloading = false; }
}

// ---------- orchestration ----------
function backoffDelay() { return Math.min(5 * 60000, 5000 * 2 ** Math.min(failures, 6)) * (0.75 + Math.random() * 0.5); }

async function cycle() {
  const auth = await getAuth();
  if (!auth?.token) { setState({ state: 'idle', error: null, signedIn: false }); await refreshPending(); return; }
  setState({ signedIn: true });
  if (!navigator.onLine) { setState({ state: 'offline' }); await refreshPending(); return; }
  setState({ state: 'syncing', error: null });
  try {
    const key = await loadKey();
    await pushAll(auth, key);
    await pullAll(auth, key);
    failures = 0; nextAllowed = 0;
    const lastSync = Date.now();
    await setMeta('sync:lastSync', lastSync);
    await refreshPending();
    setState({ state: 'idle', lastSync, error: null });
    if (Date.now() - (auth.tokenAt || 0) > 30 * 86400000) rotateToken(auth).catch(() => {});
    backgroundDownloads().catch(() => {});
  } catch (e) {
    failures++;
    nextAllowed = Date.now() + backoffDelay();
    await refreshPending().catch(() => {});
    if (e instanceof HttpError && e.status === 401) setState({ state: 'error', error: 'Signed out by the server. Please sign in again.' });
    else if (e instanceof HttpError && e.status > 0) setState({ state: 'error', error: e.message });
    else if (e instanceof HttpError) setState({ state: 'error', error: e.message }); // crypto problems
    else if (!navigator.onLine || e?.name === 'TypeError' || e?.name === 'AbortError') setState({ state: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? 'Cannot reach the server' : null });
    else { console.warn('sync failed', e); setState({ state: 'error', error: e?.message || 'Sync failed' }); }
    armTimer(nextAllowed - Date.now());
  }
}

async function rotateToken(auth) {
  const { data } = await http(auth, '/api/auth/refresh', { method: 'POST' });
  const cur = await getAuth();
  if (cur?.token === auth.token) await saveAuth({ ...cur, token: data.token, tokenAt: Date.now() });
}

/** Run a sync now (coalesced: concurrent calls share one run, with one follow-up if requested mid-run). */
export function syncNow() {
  if (running) { rerun = true; return running; }
  running = (async () => {
    try { do { rerun = false; await cycle(); } while (rerun && failures === 0); }
    finally { running = null; armTimer(); }
  })();
  return running;
}

function armTimer(ms) {
  clearTimeout(timer);
  if (!started) return;
  const regular = document.visibilityState === 'visible' ? 30000 : 60000;
  timer = setTimeout(() => syncNow().catch(() => {}), Math.max(1000, ms ?? regular));
}

const debounced = debounce(() => { if (Date.now() >= nextAllowed) syncNow().catch(() => {}); }, 3000);
function scheduleSoon(ms = 3000, force = false) {
  if (force) { failures = 0; nextAllowed = 0; }
  if (ms === 0) syncNow().catch(() => {}); else debounced();
}

function registerBackgroundSync() {
  navigator.serviceWorker?.ready?.then((reg) => reg.sync?.register('inkwell-sync')).catch(() => {});
}

export async function startSync() {
  if (started) return;
  started = true;
  offsetMs = (await getMeta('sync:offset', 0)) || 0;
  const auth = await getAuth();
  setState({ signedIn: !!auth?.token, lastSync: (await getMeta('sync:lastSync', null)) || null });
  await refreshPending();

  const onLocal = (e) => {
    if (e?.remote) return;
    refreshPendingSoon();
    getAuth().then((a) => { if (a?.token) { debounced(); if (!navigator.onLine) registerBackgroundSync(); } });
  };
  unsubs = [on('notes:changed', onLocal), on('notebooks:changed', onLocal)];
  const onOnline = () => { failures = 0; nextAllowed = 0; syncNow().catch(() => {}); };   // flush the queue immediately, then pull
  const onOffline = () => getAuth().then((a) => { if (a?.token) setState({ state: 'offline' }); });
  const onVis = () => { if (document.visibilityState === 'visible' && Date.now() >= nextAllowed) syncNow().catch(() => {}); };
  const onHide = () => { setMeta('sync:offset', offsetMs).catch(() => {}); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  unsubs.push(() => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); });

  if (auth?.token) syncNow().catch(() => {}); else armTimer();
}

export function stopSync() {
  started = false;
  clearTimeout(timer);
  debounced.cancel();
  unsubs.forEach((u) => u());
  unsubs = [];
}
