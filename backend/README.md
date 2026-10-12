# Inkwell backend (Django 4.2, shared-hosting friendly)

Pure Python (`django`, `whitenoise`). SQLite by default, MySQL optional. No Redis, Celery, cron or websockets. Serves the built app from `inkwell/static_app/` (committed; **no Node on the server**).

## Modes (`DEPLOYMENT_MODE`)
| | internal (default) | commercial |
|---|---|---|
| Accounts | created by staff (admin dashboard); temp password, forced change at first sign-in | public sign-up, e-mail verification, forgot/reset by e-mail |
| Public links | `internal` visibility (sign-in required) unless a superuser enables anonymous links | anonymous links allowed |
| SMTP | optional | needed for verification/reset (console fallback in dev) |
`GET /api/config` tells the client which mode, whether registration is open, SMTP, features, P2P availability.

## Identity and auth
E-mail is the only login (stored lower-case, unique). Public ids (`public_id`, uids) are random; no sequential ids are exposed. Tokens: random 40 bytes, only the SHA-256 is stored, 90-day sliding expiry, rotation via `/api/auth/refresh`, one live token per device. Optional TOTP 2FA (RFC 6238) with hashed single-use recovery codes and "remember this device" (30 days). Password validators (min 10, common-password check). Password change or reset signs out all other devices.

| Endpoint | Notes |
|---|---|
| `POST /api/auth/register` `login` `logout` `logout-all` `refresh` | login body `{email,password,deviceId,deviceName,code?,remember?}`; 401 `code:"2fa-required"` |
| `GET/PATCH /api/auth/me` | PATCH: `displayName`, `removeAvatar` (e-mail is staff-managed only) |
| `PUT /api/auth/avatar`, `GET /api/avatar/<id>` | png/jpeg/webp <=200 KB, magic-byte checked; visible only to the owner, collaborators, staff |
| `POST /api/auth/verify` `resend` `forgot` `reset` `password` `delete` | uniform answers (no account enumeration); links point to `#/auth/verify?token=` / `#/auth/reset?token=` |
| `POST /api/auth/2fa/setup` `enable` `disable` | |
| `GET /api/devices`, `DELETE /api/devices/<id>` | own devices (browser/OS, no IPs) |
| `GET/PUT /api/settings` | <=32 KB JSON, follows the account (LWW) |

## Sync protocol
Records: `notebooks`, `notes`, `assets` (metadata). Each stored per owner as JSON text with indexed `kind, record_id, updated_at, deleted, seq, parent_id`.
- `GET /api/sync/pull?since=<opaque cursor>&limit=` -> `{records[], cursor, hasMore, shared[], serverTime}`. Cursors are signed and bound to the user. `ETag`/`If-None-Match` gives a tiny 304 when idle. Foreign (shared) records carry `ownerId` (public id), `owner` (display name), `role`.
- `POST /api/sync/push` `{records:[{kind,id,updatedAt,deleted,data,ownerId?}]}` -> `{accepted, conflicts, rejected, cursor}`. Last-write-wins on `updatedAt` (future skew clamped to +5 min), tombstones win ties. Writing to someone else's note needs an editor share (`ownerId`); forbidden writes return the server copy with `force:true`.
- `GET /api/sync/wait` long poll (only when `LONGPOLL=1`).
- Every record is validated server-side (types, sizes, depth, forbidden keys such as `__proto__`; titles are stripped of HTML; client-only fields are dropped).
- Assets: `PUT /api/assets/<id>` (<= `ASSET_MAX_MB`), resumable `PATCH` with `Content-Range` + `X-Upload-Sha256`, `GET` with `Range`. Allowed: png jpeg webp gif pdf webm ogg mp4 (+mp3/wav); magic bytes must match; nothing else (no SVG/HTML). End-to-end encrypted blobs use `X-Encrypted: 1`. Per-user quota via plan/override.
- Client behaviour: the IndexedDB `dirty` flag is the persistent outbox (survives reloads); exponential backoff with jitter; notes/notebooks upload before large files; dirty flags cleared only for accepted records; ranged resumable downloads; LRU pruning of cached blobs when storage is tight; adaptive polling (2.5 s while a shared note is open, 30 s normally, slower when idle/hidden).

## Sharing
- People: `POST /api/share/people {kind,id,email,role:viewer|editor,expiresAt?}`, `GET ?kind=&id=`, `PATCH/DELETE /api/share/people/<uid>`, `GET /api/shared`. The answer never reveals whether an e-mail has an account (`202`); invitations to unknown e-mails are claimed at sign-up. Users can block others (`/api/blocks`) and report (`/api/report`).
- Link shares: `POST /api/share/public {kind,noteId,snapshot,visibility:private|internal|public,permission:read|write,password,expiresAt,allowDownload,regenerate}`; snapshot images/PDF via `PUT /api/share/public/<token>/asset/<key>`; page `/s/<token>` (server-rendered, sanitized, strict CSP with nonce, noindex, password attempts limited). Tokens are 192-bit HMAC-derived, only their hash is stored. `POST /api/share/link/redeem` turns a link into a share so write links sync like any shared note (`#/s/<token>` in the app). Counters for views/edits.

## Presence, activity, realtime
`POST/GET /api/presence` (15 s TTL), `GET/POST /api/notes/<id>/activity` (coalesced 30 s windows, signed pagination), both collaborator-only and name/avatar only (never e-mail or IP). Default transport is the HTTP relay. Optional P2P (`/api/rtc/*`, signalling over HTTP polling) is relay-only (`iceTransportPolicy: relay`) so peers never see each other's IP; it needs a TURN server (`TURN_URL` + `TURN_SECRET` or `TURN_USERNAME/CREDENTIAL`). Without TURN it is unavailable and the relay is used. Strict NATs cannot do direct P2P anyway.

## Trash
Deleting keeps the content for `TRASH_RETENTION_DAYS` (default 60, then purged automatically): `GET /api/trash`, `POST /api/trash/<kind>/<id>/restore`, `DELETE /api/trash/<kind>/<id>` (permanent, removes attachment files), `POST /api/trash/delete` (selection), `POST /api/trash/empty`. Cleanup runs lazily on requests; `python manage.py purge_trash` is optional for cron.

## Roles and permissions (RBAC, deny by default)
Every `/api/admin/*` and `/api/system/*` view declares the permission it needs (`@api(..., perm=...)`; a test enforces it). Built-in roles: **superuser** (everything), **admin** (users, shares, abuse, mail, audit, analytics, health, trash), **support** (read users/devices/audit, reset sessions), **analyst** (analytics only), **user**. Superusers can create custom roles with any permission set (`/api/system/roles`, UI at `#/system`). Only holders of `roles.manage` assign roles; nobody but a superuser can touch or grant superuser. Create the first superuser with `python manage.py create_admin --superuser --email ... --password ...` (or `createsuperuser`).

## System panel (`/api/system/*`, UI `#/system`)
Analytics (growth, DAU/WAU/MAU, retention cohorts, devices, content and storage, sharing, mail, abuse, trash), API stats (per-endpoint volume, error rate, latency percentiles, sync conflicts, recorded by a light middleware), server info and job health, roles, audit with CSV export, and a read-only data viewer (whitelisted columns: no password hashes, tokens, mail bodies; end-to-end encrypted note content is never shown).

## Pluggable client backend
See `docs/BACKENDS.md` (adapter contract; `backend.provider` setting; `django` and `none` included).

## Admin dashboard (token auth, audit-logged): `/api/admin/*`
overview, users (create/edit/disable/reset/revoke sessions/delete), shares and links, abuse (blocks, lockouts, reports, failed sign-ins), settings, audit (+CSV), health (+ test e-mail), trash tools. UI: `#/admin`. Django admin remains at `/admin/`.

## Security notes
DB-backed rate limits (login per IP+email with exponential lockout, register, forgot/resend, invites, link password attempts, mail caps per recipient/IP/global), honeypot + timing check on sign-up, disposable-domain blocklist, `TRUSTED_PROXIES` for client IPs, HSTS/secure cookies when `DEBUG` is off, CSP without inline scripts (inline script hashes computed from the build), `X-Frame-Options: DENY`, nosniff, `SECRET_KEY` required. Every endpoint is scoped to the authenticated principal; unauthorized and missing resources both return 404. Remaining caveat: app pages still allow inline *styles* (`style-src 'unsafe-inline'`).

## Mail abuse protection
All mail goes through a DB queue (`MailQueue`) flushed in small throttled batches (`MAIL_PER_MINUTE`) by requests, no worker. Caps (env): per address `MAIL_PER_RECIPIENT_HOURLY=3` / `_DAILY=10`, per IP, per account, global `MAIL_GLOBAL_HOURLY`; invites `INVITES_PER_DAY=20`, `INVITES_PER_ADDRESS_DAILY=2`; unverified accounts trigger no mail. Capped sends are suppressed silently (responses are identical) and raise a `mail.alert` shown in the admin Mail tab. Forgot/resend have a server-enforced cooldown (60 s, doubling to 1 h) returned as `retryAfter` for every request, whether or not an account exists. Register/forgot/resend require a hashcash proof of work (`GET /api/pow?purpose=`; `POW_BITS=12`, `POW_BITS_ABUSE=17` while abuse is detected) plus honeypot and timing checks. A suppress list (bounces, complaints, manual) and the disposable-domain blocklist are enforced.

## Passwords
Validators: 10+ characters, not common, not similar to the e-mail, numeric-only rejected, upper+lower+number. The UI shows one live rule at a time. `python manage.py create_admin --email --password` skips validators (use for the first administrator).

## Tests
`python manage.py test` (SECRET_KEY not needed under `test`).
