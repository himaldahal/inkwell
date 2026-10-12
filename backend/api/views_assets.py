import os
import re

from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse

from django.contrib.auth import get_user_model

from . import access, quota
from .models import AssetBlob, Profile
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
    owner_id = request.GET.get("owner")
    if owner_id and owner_id != str(user.pk):  # shared note's attachment
        try:
            oid = int(owner_id)
        except ValueError:
            return err("bad owner")
        if request.method == "PUT":
            role = access.role_for(user, oid, "assets", asset_id, parent_id=request.headers.get("X-Note-Id", ""))
            if role != "editor":
                return err("forbidden", 403)
        elif request.method == "DELETE" or not access.role_for(user, oid, "assets", asset_id):
            return err("not found", 404)
        user = get_user_model().objects.filter(pk=oid).first()
        if not user:
            return err("not found", 404)
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
    used = quota.used_bytes(user) - (existing.size if existing else 0)
    q = Profile.of(user).quota_bytes()
    if q and used + size > q:
        return err("storage quota exceeded", 413, quotaBytes=q, usedBytes=used)
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
