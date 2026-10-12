"""Serve user files from MEDIA_ROOT through views only: ETag/Last-Modified, Range, nosniff, per-type disposition,
and optional X-Sendfile / X-Accel-Redirect offloading (SENDFILE=apache|nginx)."""
import email.utils
import os
import re
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpResponse, StreamingHttpResponse

INLINE = ("image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf")


def _safe(path):
    p = Path(path).resolve()
    root = Path(settings.MEDIA_ROOT).resolve()
    if root not in p.parents:  # never serve anything outside MEDIA_ROOT (path traversal guard)
        raise FileNotFoundError(path)
    return p


def serve(request, path, content_type, cache="private, max-age=31536000, immutable", filename="file"):
    p = _safe(path)
    st = p.stat()
    etag = f'"{st.st_size:x}-{int(st.st_mtime):x}"'
    lm = email.utils.formatdate(st.st_mtime, usegmt=True)
    inm, ims = request.headers.get("If-None-Match"), request.headers.get("If-Modified-Since")
    if inm == etag or (not inm and ims == lm):
        r = HttpResponse(status=304)
    elif settings.SENDFILE == "apache":
        r = HttpResponse(content_type=content_type)
        r["X-Sendfile"] = str(p)
    elif settings.SENDFILE == "nginx":
        r = HttpResponse(content_type=content_type)
        r["X-Accel-Redirect"] = settings.SENDFILE_URL_PREFIX.rstrip("/") + "/" + p.relative_to(Path(settings.MEDIA_ROOT).resolve()).as_posix()
    else:
        r = _stream(request, p, st.st_size, content_type)
    r["ETag"], r["Last-Modified"], r["Cache-Control"] = etag, lm, cache
    r["Accept-Ranges"] = "bytes"
    r["X-Content-Type-Options"] = "nosniff"
    r["Content-Security-Policy"] = "default-src 'none'; sandbox"
    if content_type not in INLINE:
        r["Content-Disposition"] = f'attachment; filename="{re.sub(r"[^A-Za-z0-9._-]", "_", filename)[:60]}"'
    return r


def _stream(request, p, size, content_type):
    m = re.match(r"^bytes=(\d*)-(\d*)$", request.headers.get("Range", ""))
    if m and (m.group(1) or m.group(2)):
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = min(int(m.group(2)), size - 1) if m.group(1) and m.group(2) else size - 1
        if start > end or start >= size:
            r = HttpResponse(status=416)
            r["Content-Range"] = f"bytes */{size}"
            return r

        def gen(s=start, n=end - start + 1):
            with open(p, "rb") as f:
                f.seek(s)
                while n > 0:
                    c = f.read(min(262144, n))
                    if not c:
                        break
                    n -= len(c)
                    yield c

        r = StreamingHttpResponse(gen(), status=206, content_type=content_type)
        r["Content-Range"] = f"bytes {start}-{end}/{size}"
        r["Content-Length"] = str(end - start + 1)
        return r
    return FileResponse(open(p, "rb"), content_type=content_type)


def remove(path):
    try:
        os.remove(path)
    except OSError:
        pass
