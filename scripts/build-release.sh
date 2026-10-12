#!/usr/bin/env bash
# Build the frontend and package backend/ (with the built app) into inkwell-deploy.zip for cPanel upload.
# Node is needed ONLY here (dev machine / CI). The production server needs Python only.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
npm run build
python3 - <<'PY'
import os, zipfile
SKIP_DIRS = {".venv", "node_modules", "__pycache__", "media", "data", "staticfiles", ".git", "tmp"}
SKIP_FILES = {".env", ".secret_key", "db.sqlite3", "stderr.log"}
out = "inkwell-deploy.zip"
if os.path.exists(out):
    os.remove(out)
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk("backend"):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in SKIP_FILES or f.endswith((".pyc", ".sqlite3")):
                continue
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, "backend"))  # zip root == backend/ so it unpacks straight into the app folder
            n += 1
assert os.path.exists("backend/inkwell/static_app/index.html"), "frontend build missing"
print(f"wrote {out} ({n} files, {os.path.getsize(out)//1024} KB)")
PY
