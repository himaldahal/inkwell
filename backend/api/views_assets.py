import os
import re

from django.conf import settings
from django.db.models import Sum
from django.http import FileResponse, HttpResponse, JsonResponse

from .models import AssetBlob
from .util import api, err

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _path(user, asset_id):
    return settings.MEDIA_ROOT / "assets" / str(user.pk) / asset_id


def delete_blob_file(user, asset_id):
    try:
        os.remove(_path(user, asset_id))
    except OSError:
        pass
    AssetBlob.objects.filter(user=user, asset_id=asset_id).delete()


@api(("GET", "PUT", "DELETE"))
def asset(request, asset_id):
    if not ID_RE.match(asset_id):
        return err("bad asset id")
    user = request.user
    if request.method == "PUT":
        return _put(request, user, asset_id)
    if request.method == "DELETE":
        delete_blob_file(user, asset_id)
        return JsonResponse({"ok": True})
    b = AssetBlob.objects.filter(user=user, asset_id=asset_id).first()
    p = _path(user, asset_id)
    if not b or not p.is_file():
        return err("not found", 404)
    etag = f'"{b.size}-{int(b.updated_at.timestamp())}"'
    if request.headers.get("If-None-Match") == etag:
        r = HttpResponse(status=304)
        r["ETag"] = etag
        return r
    r = FileResponse(open(p, "rb"), content_type=b.mime)
    r["ETag"] = etag
    r["Cache-Control"] = "private, max-age=31536000, immutable"
    return r


def _put(request, user, asset_id):
    cl = request.META.get("CONTENT_LENGTH")
    if cl is None or not cl.isdigit():
        return err("Content-Length required", 411)
    size = int(cl)
    if size > settings.ASSET_MAX_BYTES:
        return err("asset too large", 413)
    existing = AssetBlob.objects.filter(user=user, asset_id=asset_id).first()
    used = AssetBlob.objects.filter(user=user).aggregate(s=Sum("size"))["s"] or 0
    used -= existing.size if existing else 0
    if settings.ASSET_QUOTA_BYTES and used + size > settings.ASSET_QUOTA_BYTES:
        return err("storage quota exceeded", 413, quotaBytes=settings.ASSET_QUOTA_BYTES, usedBytes=used)
    p = _path(user, asset_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    written = 0
    with open(tmp, "wb") as f:
        while True:
            chunk = request.read(1024 * 256)
            if not chunk:
                break
            written += len(chunk)
            if written > settings.ASSET_MAX_BYTES or written > size:
                f.close()
                os.remove(tmp)
                return err("body exceeds declared length", 413)
            f.write(chunk)
    os.replace(tmp, p)
    mime = (request.META.get("CONTENT_TYPE") or "application/octet-stream")[:120]
    AssetBlob.objects.update_or_create(
        user=user, asset_id=asset_id, defaults={"size": written, "mime": mime, "path": str(p)}
    )
    return JsonResponse({"ok": True, "size": written})


@api(("GET",))
def asset_list(request):
    rows = AssetBlob.objects.filter(user=request.user).values_list("asset_id", "size")
    return JsonResponse({"assets": [{"id": a, "size": s} for a, s in rows]})
