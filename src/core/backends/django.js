// Default backend: the bundled Django API (backend/). See backend/README.md for the protocol.
import { HttpError, registerBackend } from '../backend.js';

const CHUNK = 2 * 1024 * 1024;
const base = (s) => ((s?.serverUrl || '').trim().replace(/\/+$/, ''));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const q = (rec) => (rec.sharedOwnerId ? '?owner=' + encodeURIComponent(rec.sharedOwnerId) : '');

export async function http(session, path, { method = 'GET', json, body, headers = {}, timeout = 30000, noAuth = false, signal } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort());
  const h = { ...headers };
  if (session?.token && !noAuth) h.Authorization = 'Bearer ' + session.token;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  let res;
  try { res = await fetch(base(session) + path, { method, headers: h, body, signal: ctl.signal, credentials: 'omit' }); }
  finally { clearTimeout(t); }
  if (res.status === 304) return { res, data: null };
  let data = null;
  if ((res.headers.get('Content-Type') || '').includes('json')) { try { data = await res.json(); } catch { /* ignore */ } }
  if (!res.ok) throw new HttpError(res.status, data?.error || res.statusText, data);
  return { res, data };
}

export function createDjangoAdapter() {
  const call = async (s, path, o) => (await http(s, path, o)).data;
  return {
    name: 'django',
    capabilities: { accounts: true, sync: true, assets: true, chunkedUpload: true, rangeDownload: true, presence: true, sharing: true, publicLinks: true, admin: true, longPoll: true, settings: true },
    call,
    config: (s) => call(s, '/api/config', { noAuth: true, timeout: 8000 }),
    health: (url) => call({ serverUrl: url }, '/api/health', { noAuth: true, timeout: 8000 }),
    register: (s, c) => call(s, '/api/auth/register', { method: 'POST', json: c, noAuth: true }),
    login: (s, c) => call(s, '/api/auth/login', { method: 'POST', json: c, noAuth: true }),
    logout: (s) => call(s, '/api/auth/logout', { method: 'POST', timeout: 8000 }),
    refresh: (s) => call(s, '/api/auth/refresh', { method: 'POST' }),
    me: (s) => call(s, '/api/auth/me'),
    changePassword: (s, oldPassword, newPassword) => call(s, '/api/auth/password', { method: 'POST', json: { oldPassword, newPassword } }),
    deleteAccount: (s, password) => call(s, '/api/auth/delete', { method: 'POST', json: { password } }),
    listDevices: (s) => call(s, '/api/devices').then((d) => d.devices),
    revokeDevice: (s, id) => call(s, '/api/devices/' + encodeURIComponent(id), { method: 'DELETE' }),
    updateProfile: (s, patch) => call(s, '/api/auth/me', { method: 'PATCH', json: patch }),
    uploadAvatar: (s, blob) => call(s, '/api/auth/avatar', { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } }),
    async fetchBlob(s, path) {
      const res = await fetch(base(s) + path, { headers: { Authorization: 'Bearer ' + s.token }, credentials: 'omit' });
      return res.ok ? res.blob() : null;
    },

    async pull(s, { since, limit = 200, wait = false }) {
      const path = wait ? `/api/sync/wait?since=${encodeURIComponent(since)}&timeout=15` : `/api/sync/pull?since=${encodeURIComponent(since)}&limit=${limit}`;
      return call(s, path, { timeout: wait ? 25000 : 60000 });
    },
    push: (s, { deviceId, records }) => call(s, '/api/sync/push', { method: 'POST', json: { deviceId, records }, timeout: 60000 }),

    async uploadAsset(s, rec, bytes, { headers, onProgress, signal } = {}) {
      const total = bytes.length, url = '/api/assets/' + encodeURIComponent(rec.id) + q(rec);
      if (total <= CHUNK * 2) { await http(s, url, { method: 'PUT', body: bytes, headers, timeout: 180000, signal }); return; }
      const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
      let off = 0;
      try { off = (await http(s, `/api/assets/${encodeURIComponent(rec.id)}/upload`)).data.offset || 0; } catch { off = 0; } // resume
      if (off >= total) off = 0;
      while (off < total) {
        const end = Math.min(off + CHUNK, total);
        const h = { ...headers, 'Content-Range': `bytes ${off}-${end - 1}/${total}` };
        if (end === total) h['X-Upload-Sha256'] = sha;
        try { await http(s, url, { method: 'PATCH', body: bytes.subarray(off, end), headers: h, timeout: 120000, signal }); }
        catch (e) { if (e.status === 409 && e.body?.offset != null) { off = e.body.offset; continue; } throw e; }
        off = end; onProgress?.(off);
      }
    },
    async downloadAsset(s, rec, { start = 0, end = start + CHUNK - 1, signal } = {}) {
      const res = await fetch(base(s) + '/api/assets/' + encodeURIComponent(rec.id) + q(rec), { headers: { Authorization: 'Bearer ' + s.token, Range: `bytes=${start}-${end}` }, signal, credentials: 'omit' });
      if (res.status === 404) return null;
      if (!res.ok && res.status !== 206) throw new HttpError(res.status);
      const cr = /\/(\d+)$/.exec(res.headers.get('Content-Range') || '');
      return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), total: cr ? +cr[1] : +res.headers.get('Content-Length') || 0, type: res.headers.get('Content-Type') || '' };
    },
    getSettings: (s) => call(s, '/api/settings'),
    putSettings: (s, body) => call(s, '/api/settings', { method: 'PUT', json: body }),
  };
}
registerBackend('django', createDjangoAdapter);
