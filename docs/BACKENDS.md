# Pluggable backends

`src/core/sync.js` talks only to an adapter from `src/core/backend.js`. The provider is chosen with the setting `backend.provider` (default `django`, implemented in `src/core/backends/django.js`). `none` (`backends/none.js`) is local-only.

```js
import { registerBackend } from '../backend.js';
registerBackend('myprovider', async () => adapter);   // then set backend.provider = 'myprovider'
```
Import your module once (for example from `main.js`) so it registers itself.

## Adapter contract
`session` is the stored auth record `{serverUrl, token, user, ...}`; every method is async.

| Method | Purpose |
|---|---|
| `name`, `capabilities` | `{accounts, sync, assets, chunkedUpload, rangeDownload, presence, sharing, publicLinks, admin, longPoll, settings}`; the UI hides features whose capability is false |
| `config(session)` | `{mode, registrationOpen, features}` |
| `health(url)` | reachability check |
| `register(s0, creds)` / `login(s0, creds)` | creds `{email, password, displayName?, code?, remember?, deviceId, deviceName, pow?}` -> `{token, user, mustChangePassword}` or `{verificationRequired:true}`. Throw `HttpError(status, msg, {code})` (`2fa-required`, `unverified`) |
| `logout`, `refresh` | end session / rotate token (`{token}`) |
| `me`, `changePassword`, `deleteAccount`, `listDevices`, `revokeDevice`, `updateProfile`, `uploadAvatar`, `fetchBlob` | account management |
| `pull(s, {since, limit, wait})` | `{records, cursor, hasMore, shared?, serverTime}` or `null` when nothing changed. `cursor` is opaque; first call uses `'0'` |
| `push(s, {deviceId, records})` | `{accepted:[{kind,id,updatedAt}], conflicts:[wireRecord], rejected:[{kind,id,error}], serverTime}` |
| `uploadAsset(s, rec, bytes, {headers, onProgress, signal})` | store a blob (chunk/resume however you like) |
| `downloadAsset(s, rec, {start, end, signal})` | `{status, bytes, total, type}` (206 chunks or 200 whole) or `null` if missing |
| `getSettings` / `putSettings` | account settings blob (LWW by `updatedAt`) |
| `call(s, path, opts)` | provider-specific escape hatch used by the sharing/admin/presence UIs |

Wire record: `{kind: 'notebooks'|'notes'|'assets', id, updatedAt, deleted, data, ownerId?, owner?, role?, force?}`. Conflict policy is last-write-wins on `updatedAt`; tombstones are `deleted:true`; a `conflicts` entry is the server's newer copy (with `force:true` meaning "discard your local edit").

## Example: local-only (`none`)
```js
registerBackend('none', () => ({
  name: 'none', capabilities: { accounts: false, sync: false },
  config: async () => ({ mode: 'local', registrationOpen: false, features: {} }),
  pull: async () => null,
  push: async () => ({ accepted: [], conflicts: [], rejected: [], serverTime: Date.now() }),
  /* every other method throws or returns an empty value, see src/core/backends/none.js */
}));
```

## Sketch: WebDAV-like store (one JSON file per record)
```js
registerBackend('webdav', () => {
  const url = (s, p) => s.serverUrl.replace(/\/$/, '') + '/inkwell/' + p;
  const auth = (s) => ({ Authorization: 'Basic ' + btoa(s.user.email + ':' + s.token) });
  return {
    name: 'webdav', capabilities: { accounts: false, sync: true, assets: true },
    config: async () => ({ mode: 'webdav', registrationOpen: false, features: {} }),
    async login(s0, c) { return { token: c.password, user: { id: c.email, email: c.email, name: c.email } }; },
    async push(s, { records }) {            // PUT <kind>/<id>.json, guard with If-Match for LWW
      const accepted = [];
      for (const r of records) { await fetch(url(s, `${r.kind}/${r.id}.json`), { method: 'PUT', headers: auth(s), body: JSON.stringify(r) }); accepted.push({ kind: r.kind, id: r.id, updatedAt: r.updatedAt }); }
      return { accepted, conflicts: [], rejected: [], serverTime: Date.now() };
    },
    async pull(s, { since }) {              // PROPFIND for files newer than `since` (a timestamp string), then GET each
      /* list, filter by getlastmodified > since, GET, return { records, cursor: String(Date.now()), hasMore: false } */
    },
    async uploadAsset(s, rec, bytes) { await fetch(url(s, `assets/${rec.id}`), { method: 'PUT', headers: auth(s), body: bytes }); },
    async downloadAsset(s, rec) { const r = await fetch(url(s, `assets/${rec.id}`), { headers: auth(s) }); return r.ok ? { status: 200, bytes: new Uint8Array(await r.arrayBuffer()), total: 0, type: '' } : null; },
    /* me/logout/refresh/listDevices/... can return stubs; sharing and presence stay disabled via capabilities */
  };
});
```
The adapter should keep `updatedAt` as the conflict clock and return the stored copy in `conflicts` when it is newer than the pushed one.
