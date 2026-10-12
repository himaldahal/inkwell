# Deploying Inkwell

**Node.js is never needed on the server.** The frontend is built on a dev machine or in CI and the output (`backend/inkwell/static_app/`) is committed. Production needs only Python 3.9+ and `pip install -r requirements.txt`.

## Build a release (dev machine / CI)
`./scripts/build-release.sh` runs `npm run build` and writes `inkwell-deploy.zip` (the `backend/` folder only: no `node_modules`, `.venv`, database, media or `.env`). GitHub Actions (`.github/workflows/release.yml`) does the same on every push to `main`, checks the committed build is current, runs the Django tests and uploads the zip as an artifact.

## cPanel: Setup Python App (Passenger)
1. File Manager: upload and extract `inkwell-deploy.zip` into e.g. `~/inkwell` (the zip root is the app folder).
2. cPanel > **Setup Python App** > Create: Python 3.9+, application root `inkwell`, application URL (domain or sub-domain), startup file `passenger_wsgi.py`, entry point `application`.
3. In the app page: **Configuration files** add `requirements.txt` > *Run Pip Install* (or in the terminal: `source <venv>/bin/activate && pip install -r requirements.txt`).
4. **Environment variables** (or a `.env` next to `manage.py`, see `.env.example`): `SECRET_KEY` (required), `DEBUG=false`, `ALLOWED_HOSTS=yourdomain`, `DEPLOYMENT_MODE=internal|commercial`, `APP_URL=https://yourdomain`, `TRUSTED_PROXIES=127.0.0.1`, `TRUST_PROXY=true`, optional `DB_PATH`, `MEDIA_ROOT` (put them outside the web root), `ASSET_QUOTA_MB`.
5. Terminal (inside the app's virtualenv, in the app folder):
   ```
   python manage.py migrate
   python manage.py collectstatic --noinput     # admin assets only
   python manage.py createsuperuser             # e-mail + password
   ```
6. Click **Restart**. Open the site; sign in with the superuser (internal mode: create other users under `#/admin`).
7. Force HTTPS in `.htaccess` (public_html or the app's domain root):
   ```
   RewriteEngine On
   RewriteCond %{HTTPS} off
   RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]
   <FilesMatch "^(sw\.js|index\.html|manifest\.webmanifest)$">
     Header set Cache-Control "no-cache"
   </FilesMatch>
   ```
   Passenger already routes everything to the app; the service worker needs HTTPS.
8. Updating: upload the new zip over the folder (keep `.env`, `data/`, `media/`), run `migrate`, restart.

### MySQL (optional)
Create a database and user in cPanel, set `DB_ENGINE=mysql DB_NAME DB_USER DB_PASSWORD DB_HOST`, and `pip install mysqlclient` (or the pure-Python `PyMySQL`), then `migrate`.

## E-mail (needed for commercial mode: verification, password reset, share notices)
Create a mailbox in cPanel > Email Accounts, then set:
```
EMAIL_HOST=mail.yourdomain.com   (see "Connect devices" in cPanel)
EMAIL_PORT=587  EMAIL_USE_TLS=true        # or EMAIL_PORT=465 EMAIL_USE_SSL=true
EMAIL_USER=noreply@yourdomain.com  EMAIL_PASSWORD=...
DEFAULT_FROM_EMAIL=Inkwell <noreply@yourdomain.com>
```
Typical hosts: cPanel `mail.<domain>` 465 SSL / 587 STARTTLS; Gmail `smtp.gmail.com` 587 (app password); SendGrid `smtp.sendgrid.net` 587, user `apikey`; Mailgun `smtp.mailgun.org` 587. Use the admin dashboard > System > "Send test" to verify. Without `EMAIL_HOST` mail goes to the log and verification/reset are disabled.

## Run locally
```
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DEBUG=1 .venv/bin/python manage.py migrate && DEBUG=1 .venv/bin/python manage.py createsuperuser
DEBUG=1 .venv/bin/python manage.py runserver        # http://127.0.0.1:8000 serves the committed build
npm install && npm run dev                          # Vite dev server proxies /api to :8000
```

## Optional
- `LONGPOLL=1` long-poll endpoint (skip on hosts that kill long requests).
- P2P live sessions need a TURN server (`TURN_URL`, `TURN_SECRET`); without it the HTTP relay is used.
- Cron (not required): `python manage.py purge_trash`.
