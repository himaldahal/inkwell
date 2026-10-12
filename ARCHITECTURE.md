# Inkwell – Architecture & Contracts

Stack: Vite + vanilla ES modules (no UI framework), `idb` for IndexedDB, `vite-plugin-pwa` (Workbox injectManifest-free generateSW), `pdfjs-dist` + `pdf-lib`. Backend: **Django 4.2 LTS** (+ plain Django views returning JSON, token auth, SQLite default / MySQL optional) in `backend/`. **Shared-hosting constraints (hard requirements):** pure-Python deps only (django, whitenoise; nothing needing compilation), no Redis/Celery/websockets/cron-required workers, sync is plain HTTP polling, WSGI entry `backend/passenger_wsgi.py` (cPanel 'Setup Python App'), static via WhiteNoise, config via env vars/`.env`, DB path configurable. The frontend is built by Vite into `backend/inkwell/static_app/` which is COMMITTED so the host needs no Node. Django serves index.html, sw.js, manifest at root scope.

## Data model (IndexedDB db `inkwell`, all records have `id` (uuid), `updatedAt` (ms), `deleted` (bool tombstone), `dirty` (0/1 local-unsynced flag))
- `notebooks`: {id,name,color,icon,parentId|null,order,createdAt,updatedAt,deleted,dirty}   (folders/subjects; nesting allowed)
- `notes`: {id,title,notebookId|null,tags:string[],pinned,favorite,archived,trashedAt|null,template:'blank|lined|grid|dot|cornell|todo', paperColor,
   pages:[{id,type:'draw'|'pdf',bg?: template, pdfAssetId?, pdfPage?, width,height, strokes:[Stroke], items:[Item]}],
   text: string (HTML of typed text layer / outline), preview: dataURL|null (thumbnail), textIndex:string (plain text for search), recordings:[{id,assetId,duration,createdAt,markers:[{t,pageId}]}],
   createdAt,updatedAt,deleted,dirty}
   - Stroke: {id,tool:'pen'|'highlighter'|'pencil',color,size,pts:[x,y,pressure,...flat numbers]}  (flat Float array, coords in page units)
   - Item: {id,type:'image'|'text'|'shape'|'sticker', x,y,w,h,rotation, data...}
- `assets`: {id,noteId,kind:'image'|'pdf'|'audio',mime,blob,size,createdAt,updatedAt,deleted,dirty}  (blobs; synced separately as base64/binary)
- `meta`: key-value (settings, sync cursor, deviceId, auth)

## Module ownership (agents must only edit their own files; shared files only by lead)
- core/    : db.js, store.js (events), router.js, utils.js, settings.js  -> Agent CORE (db.js/utils.js written by lead already)
- ui/ + styles/ + main.js + index.html: app shell, library, sidebar, search, settings, dialogs -> Agent CORE
- editor/  : note editor, canvas engine, toolbar, page nav -> Agent EDITOR  (exports `mountEditor(container, noteId, ctx)`)
- features/pdf.js, features/audio.js, features/export.js -> Agent MEDIA (pdf import/annotate render, audio record/playback, export PDF/PNG/JSON/Markdown, import backups)
- core/sync.js, backend/ (Django project, API, deploy docs, tests), vite.config.js, public/ (manifest, icons), sw config, ui/syncSettings.js -> Agent SYNC/PWA

## Public module APIs (contracts)
core/db.js (provided): `getDB()`, `putRecord(store, rec)` (sets updatedAt, dirty=1), `getRecord(store,id)`, `getAll(store)`, `softDelete(store,id)`, `listNotes({notebookId,tag,search,view})`, `newId()`, `getMeta(k)`, `setMeta(k,v)`, `putAsset`, `getAsset`, `rawPut(store,rec)` (no dirty marking; for sync), `getDirty(store)`.
core/store.js (provided): tiny event bus `on(evt,fn)`, `emit(evt,data)`; events: `notes:changed`, `notebooks:changed`, `sync:status`, `settings:changed`, `route:changed`, `toast`.
Editor: `import {mountEditor} from '../editor/index.js'` -> `mountEditor(el, noteId, {onClose}) -> {destroy()}`; editor autosaves via `putRecord('notes', note)` debounced 600ms and emits `notes:changed`.
Media: `features/pdf.js`: `importPdfToNote(file, noteId|null) -> noteId`, `renderPdfPage(assetId, pageNo, canvas, scale)`; `features/audio.js`: `createRecorder(noteId)`, `mountPlayer(el, recording)`; `features/export.js`: `exportNote(note, 'pdf'|'png'|'md'|'json')`, `exportAll()`, `importBackup(file)`.
Sync: `core/sync.js`: `startSync()`, `syncNow()`, `getSyncState()`; protocol in backend/README.md (REST: POST /api/auth/register|login, GET /api/sync/pull?since=, POST /api/sync/push, PUT/GET /api/assets/<id>). Last-write-wins per record by `updatedAt`, tombstones, push dirty + pull since cursor, runs on: app start, 30s interval when visible, on local change (debounced 3s), on `online` event, on visibility regain, and Background Sync when available.

## Design
Name: Inkwell. Palette: ink indigo `#4f46e5`-ish accent, warm paper neutrals, full dark mode via CSS vars (prefers-color-scheme + manual). Responsive: phone (bottom tab bar, full-screen editor), tablet/iPad (collapsible sidebar + list + editor, Apple Pencil pressure/palm rejection), desktop (3-pane, keyboard shortcuts). Use `100dvh`, safe-area insets, `touch-action:none` only on canvas.
