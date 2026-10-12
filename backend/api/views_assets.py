import hashlib
import os
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import FileResponse, HttpResponse, JsonResponse, StreamingHttpResponse

from . import access, quota, validate
from .models import AssetBlob, Profile
from .util import api, err

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
INLINE = ("image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf")


def _path(user, asset_id):
    return settings.MEDIA_ROOT / "assets" / str(user.pk) / asset_id


def delete_blob_file(user, asset_id):
    for ext in ("", ".part"):
        try:
            os.remove(str(_path(user, asset_id)) + ext)
        except OSError:
            pass
    AssetBlob.objects.filter(user=user, asset_id=asset_id).delete()


def _resolve_owner(request, asset_id):
    """(owner, error_response). Unauthorized and missing both give the same 404."""
    user = request.user
    pid = request.GET.get("owner")
    if not pid or pid == user.public_id:
        return user, None
    nf = err("not found", 404)
    owner = get_user_model().objects.filter(public_id=pid[:32]).first()
    if not owner:
        return None, nf
    if request.method in ("PUT", "PATCH"):
        if access.role_for(user, owner.pk, "assets", asset_id, parent_id=request.headers.get("X-Note-Id", "")) != "editor":
            return None, nf
    elif request.method == "DELETE" or not access.role_for(user, owner.pk, "assets", asset_id):
        return None, nf
    return owner, None


@api(("GET", "PUT", "PATCH", "DELETE"))
def asset(request, asset_id):
    if not ID_RE.match(asset_id):
        return err("not found", 404)
    owner, bad = _resolve_owner(request, asset_id)
    if bad:
        return bad
    if request.method == "PUT":
        return _put(request, owner, asset_id)
    if request.method == "PATCH":
        return _patch(request, owner, asset_id)
    if request.method == "DELETE":
        delete_blob_file(owner, asset_id)
        return JsonResponse({"ok": True})
    return _get(request, owner, asset_id)


def _get(request, owner, asset_id):
    b = AssetBlob.objects.filter(user=owner, asset_id=asset_id).first()
    p = _path(owner, asset_id)
    if not b or not p.is_file():
        return err("not found", 404)
    etag = f'"{b.size}-{int(b.updated_at.timestamp())}"'
    if request.headers.get("If-None-Match") == etag:
        r = HttpResponse(status=304)
        r["ETag"] = etag
        return r
    rng = re.match(r"^bytes=(\d*)-(\d*)$", request.headers.get("Range", ""))
    if rng and (rng.group(1) or rng.group(2)):
        start = int(rng.group(1)) if rng.group(1) else max(0, b.size - int(rng.group(2)))
        end = min(int(rng.group(2)), b.size - 1) if rng.group(1) and rng.group(2) else b.size - 1
        if start > end or start >= b.size:
            r = HttpResponse(status=416)
            r["Content-Range"] = f"bytes */{b.size}"
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

        r = StreamingHttpResponse(gen(), status=206, content_type=b.mime)
        r["Content-Range"] = f"bytes {start}-{end}/{b.size}"
        r["Content-Length"] = str(end - start + 1)
    else:
        r = FileResponse(open(p, "rb"), content_type=b.mime)
    r["Accept-Ranges"] = "bytes"
    r["ETag"] = etag
    r["Cache-Control"] = "private, max-age=31536000, immutable"
    r["X-Content-Type-Options"] = "nosniff"
    r["Content-Security-Policy"] = "default-src 'none'; sandbox"
    if b.mime not in INLINE:
        r["Content-Disposition"] = "attachment"
    return r


def _check_quota(owner, size, replacing):
    used = quota.used_bytes(owner) - replacing
    q = Profile.of(owner).quota_bytes()
    if q and used + size > q:
        return err("storage quota exceeded", 413, quotaBytes=q, usedBytes=used)
    if size > settings.ASSET_MAX_BYTES:
        return err("asset too large", 413)
    return None


def _kind_mime(head, declared, encrypted):
    if encrypted:  # end-to-end encrypted blob: opaque ciphertext
        return "application/octet-stream"
    s = validate.sniff(head)
    if not s or not validate.mime_ok(declared, s):
        return None
    return (declared or "").split(";")[0].strip().lower() if s in ("webm", "mp4") else s


def _finish(owner, asset_id, tmp, size, mime):
    p = _path(owner, asset_id)
    os.replace(tmp, p)
    AssetBlob.objects.update_or_create(user=owner, asset_id=asset_id, defaults={"size": size, "mime": mime, "path": str(p)})


def _put(request, owner, asset_id):
    cl = request.META.get("CONTENT_LENGTH")
    if cl is None or not cl.isdigit():
        return err("Content-Length required", 411)
    size = int(cl)
    ex = AssetBlob.objects.filter(user=owner, asset_id=asset_id).first()
    bad = _check_quota(owner, size, ex.size if ex else 0)
    if bad:
        return bad
    first = request.read(16)
    mime = _kind_mime(first, request.META.get("CONTENT_TYPE"), request.headers.get("X-Encrypted") == "1")
    if not mime:
        return err("unsupported file type", 415)
    d = _path(owner, asset_id).parent
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (asset_id + ".part")
    written = len(first)
    with open(tmp, "wb") as f:
        f.write(first)
        while True:
            chunk = request.read(262144)
            if not chunk:
                break
            written += len(chunk)
            if written > size:
                f.close()
                os.remove(tmp)
                return err("body exceeds declared length", 413)
            f.write(chunk)
    _finish(owner, asset_id, tmp, written, mime)
    return JsonResponse({"ok": True, "size": written})


def _patch(request, owner, asset_id):
    """Resumable upload: PATCH with 'Content-Range: bytes START-END/TOTAL'. Out-of-order chunks get 409 + current offset.
    The last chunk may carry X-Upload-Sha256 which is verified before the file is published."""
    m = re.match(r"^bytes (\d+)-(\d+)/(\d+)$", request.headers.get("Content-Range", ""))
    if not m:
        return err("Content-Range required", 400)
    start, end, total = map(int, m.groups())
    if total > settings.ASSET_MAX_BYTES or end < start or end >= total:
        return err("bad range", 413 if total > settings.ASSET_MAX_BYTES else 400)
    d = _path(owner, asset_id).parent
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (asset_id + ".part")
    have = tmp.stat().st_size if tmp.exists() else 0
    if start == 0 and have:
        tmp.unlink()
        have = 0
    if start != have:
        return err("offset mismatch", 409, offset=have)
    ex = AssetBlob.objects.filter(user=owner, asset_id=asset_id).first()
    if start == 0:
        bad = _check_quota(owner, total, ex.size if ex else 0)
        if bad:
            return bad
    body = request.read(end - start + 2)
    if len(body) != end - start + 1:
        return err("body length does not match range", 400)
    if start == 0 and not _kind_mime(body[:16], request.META.get("CONTENT_TYPE"), request.headers.get("X-Encrypted") == "1"):
        return err("unsupported file type", 415)
    with open(tmp, "ab") as f:
        f.write(body)
    if end + 1 < total:
        return JsonResponse({"offset": end + 1}, status=202)
    h = hashlib.sha256()
    with open(tmp, "rb") as f:
        for c in iter(lambda: f.read(262144), b""):
            h.update(c)
    want = request.headers.get("X-Upload-Sha256", "").lower()
    if want and want != h.hexdigest():
        tmp.unlink()
        return err("checksum mismatch", 422)
    mime = _kind_mime(open(tmp, "rb").read(16), request.META.get("CONTENT_TYPE"), request.headers.get("X-Encrypted") == "1")
    _finish(owner, asset_id, tmp, total, mime or "application/octet-stream")
    return JsonResponse({"ok": True, "size": total})


@api(("GET",))
def asset_list(request):
    rows = AssetBlob.objects.filter(user=request.user).values_list("asset_id", "size")
    return JsonResponse({"assets": [{"id": a, "size": s} for a, s in rows]})


@api(("GET",))
def upload_status(request, asset_id):
    p = _path(request.user, asset_id) if ID_RE.match(asset_id) else None
    tmp = p.with_suffix(".part") if p else None
    return JsonResponse({"offset": tmp.stat().st_size if tmp and tmp.exists() else 0})
