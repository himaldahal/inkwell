#!/usr/bin/env bash
# Share a local Inkwell instance through an ngrok tunnel (for demos and testing, not production).
#   ./scripts/share-ngrok.sh your-name.ngrok-free.dev [--open-registration]
# Needs: backend set up (scripts/setup-dev.sh), the ngrok CLI signed in with your authtoken.
set -euo pipefail
HOST="${1:?usage: share-ngrok.sh <your-domain.ngrok-free.dev> [--open-registration]}"
REG=false; [[ "${2:-}" == "--open-registration" ]] && REG=true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; B="$ROOT/backend"
[[ -f "$B/.env" ]] || { echo "Run scripts/setup-dev.sh first"; exit 1; }
upsert() { grep -q "^$1=" "$B/.env" && sed -i "s#^$1=.*#$1=$2#" "$B/.env" || echo "$1=$2" >> "$B/.env"; }
upsert DEBUG 0; upsert ALLOWED_HOSTS "$HOST,127.0.0.1,localhost"; upsert APP_URL "https://$HOST"
upsert CSRF_TRUSTED_ORIGINS "https://$HOST"; upsert TRUST_PROXY true; upsert TRUSTED_PROXIES 127.0.0.1
upsert ALLOW_REGISTRATION "$REG"
# shellcheck disable=SC1091
source "$B/.venv/bin/activate"
( cd "$B" && python manage.py migrate --noinput && python manage.py runserver 127.0.0.1:8000 --noreload ) &
DJ=$!; trap 'kill $DJ 2>/dev/null || true' EXIT INT TERM
sleep 3; echo "Sharing https://$HOST (registration open: $REG)"; ngrok http --url="$HOST" 8000
