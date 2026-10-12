# Inkwell

Offline-first handwriting and note-taking PWA (Vite + vanilla ES modules) with optional cloud sync, sharing and an admin dashboard (Django backend in `backend/`).

- `npm run dev` - dev server (proxies `/api` to Django on :8000). `npm run build` - builds into `backend/inkwell/static_app/` (committed; the server needs no Node).
- Backend and protocol: `backend/README.md`. Deployment (cPanel, SMTP): `DEPLOY.md`. Release zip: `scripts/build-release.sh`.
- Icons: `node scripts/gen-icons.mjs` regenerates `public/icons/*` and `public/favicon.svg`.

## Required tags in `index.html` (iOS / PWA)
```html
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#4f46e5">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Inkwell">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

## Client modules
- `core/sync.js`: `startSync`, `syncNow`, `getSyncState`, `stopSync`, `signIn`, `signOut`, `apiCall`, `ensureAsset(id)`, `setLiveMode(bool)`, `getQueue`, `retryFailed`. Emits `sync:status {state,lastSync,pending,error}` and `sync:progress`. Notes shared with you carry `sharedBy`, `sharedRole` (`read|write`), `sharedOwnerId`.
- `core/pwa.js`: `registerPWA()` (update prompt, shortcuts, file/share targets, background sync wake-ups).
- `core/activity.js`: `startActivity({noteId, ownerId})` -> presence heartbeat + coalesced activity reports; emits `presence:update`, `activity:update`. `authorId()` gives the opaque id to stamp on strokes.
- `core/rtc.js`: optional relay-only P2P channel (needs TURN); falls back to HTTP polling.
- `core/crypto.js`: PBKDF2 -> AES-GCM. Per-note lock helpers: `encryptString(plain, passphrase)`, `decryptString(packed, passphrase)` (throws on a wrong passphrase), `isEncryptedString`, also as `lockNoteCrypto`. A lost passphrase cannot be recovered.
- UI: `ui/auth.js`, `ui/admin.js`, `ui/share.js` (`openShareDialog(noteId)`), `ui/shareView.js`, `ui/syncSettings.js` (`mountSyncSettings(el)`), shared helpers in `ui/sxkit.js`.

Exports are PDF only (single note or ZIP of PDFs).
