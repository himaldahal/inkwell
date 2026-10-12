// Pluggable sync backend. sync.js talks ONLY to the adapter returned by getBackend(); see docs/BACKENDS.md.
// Providers are registered by name and selected with the setting `backend.provider` (default 'django').
import { getSetting } from './settings.js';

export class HttpError extends Error {
  constructor(status, msg, body) { super(msg || 'HTTP ' + status); this.status = status; this.body = body; this.code = body?.code; }
}

const registry = new Map();
let cache = { name: null, adapter: null };

/** registerBackend('supabase', () => adapter | Promise<adapter>) */
export function registerBackend(name, factory) { registry.set(name, factory); if (cache.name === name) cache = { name: null, adapter: null }; }
export const listBackends = () => [...registry.keys()];
export const getBackendName = () => getSetting('backend.provider') || 'django';

export async function getBackend() {
  const name = registry.has(getBackendName()) ? getBackendName() : 'django';
  if (cache.name !== name) {
    const f = registry.get(name);
    cache = { name, adapter: await f() };
  }
  return cache.adapter;
}

/* Adapter contract (all methods async; `session` is the stored auth record {serverUrl, token, user, ...}):
 *   name, capabilities {accounts, sync, assets, chunkedUpload, rangeDownload, presence, sharing, publicLinks, admin, longPoll, settings}
 *   config(session?)                                  -> {mode, registrationOpen, features:{...}, ...}
 *   health(url)                                       -> {ok}
 *   register(session0, creds) / login(session0, creds)-> {token, user, mustChangePassword} | {verificationRequired}
 *   logout(session) / refresh(session)                -> void / {token}
 *   me(session) / changePassword / deleteAccount / listDevices / revokeDevice / updateProfile / uploadAvatar / fetchBlob(session, path)
 *   pull(session, {since, limit, wait})               -> {records, cursor, hasMore, shared?, serverTime} | null (nothing new)
 *   push(session, {deviceId, records})                -> {accepted:[{kind,id,updatedAt}], conflicts:[record], rejected:[{kind,id,error}], serverTime}
 *   uploadAsset(session, rec, bytes, {headers, onProgress, signal})
 *   downloadAsset(session, rec, {start, end, signal}) -> {status, bytes, total, type} | null (missing)
 *   getSettings(session) / putSettings(session, {settings, updatedAt})
 *   call(session, path, opts)                         -> backend specific JSON call used by UI (presence, sharing, admin...)
 * Record shape on the wire: {kind:'notebooks'|'notes'|'assets', id, updatedAt, deleted, data, ownerId?, owner?, role?, force?}
 */
