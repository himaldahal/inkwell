#!/usr/bin/env bash
# Inkwell – one-shot development setup.
#   ./scripts/setup-dev.sh                 set up everything
#   ./scripts/setup-dev.sh --run           set up, then start Django (8000) and Vite (5173)
#   ./scripts/setup-dev.sh --no-frontend   backend only (use the committed build)
#   ./scripts/setup-dev.sh --email you@example.com --password 'secret'   create the first superuser non-interactively
#   ./scripts/setup-dev.sh --mode commercial                              DEPLOYMENT_MODE for .env (default: internal)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
RUN=0; FRONTEND=1; EMAIL=""; PASSWORD=""; MODE="internal"; PY="${PYTHON:-python3}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN=1 ;;
    --no-frontend) FRONTEND=0 ;;
    --email) EMAIL="${2:?--email needs a value}"; shift ;;
    --password) PASSWORD="${2:?--password needs a value}"; shift ;;
    --mode) MODE="${2:?--mode needs internal|commercial}"; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }

need "$PY"
"$PY" - <<'PYV' || { echo "Python 3.10+ is required" >&2; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)
PYV

say "Python virtual environment"
[[ -d "$BACKEND/.venv" ]] || "$PY" -m venv "$BACKEND/.venv"
# shellcheck disable=SC1091
source "$BACKEND/.venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$BACKEND/requirements.txt"

say "Backend configuration (.env)"
if [[ ! -f "$BACKEND/.env" ]]; then
  SECRET="$("$PY" -c 'import secrets; print(secrets.token_urlsafe(64))')"
  cat > "$BACKEND/.env" <<ENV
SECRET_KEY=$SECRET
DEBUG=1
DEPLOYMENT_MODE=$MODE
ALLOWED_HOSTS=127.0.0.1,localhost
APP_URL=http://127.0.0.1:8000
ENV
  echo "Created backend/.env (development values; never reuse it in production)."
else
  echo "backend/.env already exists, leaving it untouched."
fi

say "Database"
( cd "$BACKEND" && python manage.py migrate --noinput )

say "Static files"
( cd "$BACKEND" && python manage.py collectstatic --noinput -v0 ) && echo "collectstatic done (backend/staticfiles)"

if [[ -n "$EMAIL" && -n "$PASSWORD" ]]; then
  say "Superuser $EMAIL"
  ( cd "$BACKEND" && python manage.py create_admin --email "$EMAIL" --password "$PASSWORD" --superuser ) \
    || echo "Could not create the user (it may already exist)."
else
  echo "Tip: create an administrator with"
  echo "  (cd backend && . .venv/bin/activate && python manage.py create_admin --email you@example.com --password '...' --superuser)"
fi

if [[ $FRONTEND -eq 1 ]]; then
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    say "Frontend dependencies (Node is needed on the dev machine only)"
    ( cd "$ROOT" && npm install --no-audit --no-fund )
  else
    echo "Node/npm not found: skipping the frontend. The committed build in backend/inkwell/static_app is served by Django."
    FRONTEND=0
  fi
fi

say "Done"
cat <<MSG
Backend:   cd backend && . .venv/bin/activate && python manage.py runserver 127.0.0.1:8000
Frontend:  npm run dev          (hot reload on http://localhost:5173, proxies /api to Django)
Build:     npm run build        (writes backend/inkwell/static_app, which is committed)
App:       http://127.0.0.1:8000
MSG

if [[ $RUN -eq 1 ]]; then
  say "Starting servers (Ctrl+C stops both)"
  ( cd "$BACKEND" && python manage.py runserver 127.0.0.1:8000 ) &
  DJ=$!
  trap 'kill $DJ 2>/dev/null || true' EXIT INT TERM
  if [[ $FRONTEND -eq 1 ]]; then ( cd "$ROOT" && npm run dev ); else wait $DJ; fi
fi
