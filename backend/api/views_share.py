"""Sharing with specific users (viewer/editor) and public-link management."""
import json
import os
import re
import secrets
import shutil
from datetime import datetime, timezone as dtz

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.http import JsonResponse

from . import access, emails, quota
from .audit import audit
from .models import Profile, PublicAsset, PublicLink, Record, Share, now_ms
from .sanitize import sanitize_html
from .util import api, err, hit, parse_json

User = get_user_model()
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _title_of(owner, kind, rid):
    r = Record.objects.filter(user=owner, kind=kind, record_id=rid).first()
    if not r:
        return None
    try:
        d = json.loads(r.data)
    except ValueError:
        return ""
    return d.get("title") or d.get("name") or ""


# ---------- people ----------
def _share_json(s, with_recipient=True):
    d = {"id": s.pk, "kind": s.kind, "recordId": s.record_id, "role": s.role, "createdAt": s.created_at.isoformat()}
    if with_recipient:
        d["recipient"] = {"id": s.recipient_id, "username": s.recipient.get_username(), "email": s.recipient.email}
    return d


@api(("GET", "POST"))
def people(request):
    """GET ?kind=notes&id=.. -> collaborators (owner only). POST {kind,id,email,role} -> add or update."""
    me = request.user
    if request.method == "GET":
        kind, rid = request.GET.get("kind", "notes"), request.GET.get("id", "")
        qs = Share.objects.filter(owner=me, kind=kind, record_id=rid).select_related("recipient")
        return JsonResponse({"people": [_share_json(s) for s in qs]})
    b = parse_json(request) or {}
    kind, rid = b.get("kind", "notes"), str(b.get("id") or "")
    role = b.get("role", "viewer")
    email = str(b.get("email") or "").strip().lower()
    if kind not in ("notes", "notebooks") or role not in ("viewer", "editor") or not rid:
        return err("invalid request")
    if not hit(f"share:{me.pk}", settings.SHARE_RATE_LIMIT, 3600):
        return err("too many invitations, try again later", 429)
    if not Record.objects.filter(user=me, kind=kind, record_id=rid, deleted=False).exists():
        return err("sync this item before sharing it", 409)
    target = User.objects.filter(email__iexact=email, is_active=True).first() if email else None
    if target is None and b.get("username"):
        target = User.objects.filter(username__iexact=str(b["username"]).strip(), is_active=True).first()
    if not target:
        return err("no registered user with that e-mail address", 404)
    if target.pk == me.pk:
        return err("you already own this")
    s, created = Share.objects.update_or_create(owner=me, recipient=target, kind=kind, record_id=rid, defaults={"role": role})
    access.bump(me.pk, kind, rid)
    audit(request, "share.add", me, f"{kind}:{rid} -> {target.get_username()} ({role})")
    if created and target.email and settings.SMTP_ENABLED:
        emails.send_share(request, me, target, _title_of(me, kind, rid), role)
    return JsonResponse({"share": _share_json(s)}, status=201 if created else 200)


@api(("DELETE", "POST", "PATCH"))
def person(request, share_id):
    """Owner revokes / changes role; a recipient may remove themselves (leave)."""
    s = Share.objects.filter(pk=share_id).first()
    if not s or me_not_involved(request.user, s):
        return err("not found", 404)
    if request.method == "DELETE":
        s.delete()
        audit(request, "share.revoke", request.user, f"{s.kind}:{s.record_id}")
        return JsonResponse({"ok": True})
    if s.owner_id != request.user.pk:
        return err("forbidden", 403)
    role = (parse_json(request) or {}).get("role")
    if role not in ("viewer", "editor"):
        return err("invalid role")
    s.role = role
    s.save()
    return JsonResponse({"share": _share_json(s)})


def me_not_involved(user, s):
    return user.pk not in (s.owner_id, s.recipient_id)


@api(("GET",))
def shared_with_me(request):
    out = []
    for s in Share.objects.filter(recipient=request.user).select_related("owner"):
        out.append({"shareId": s.pk, "kind": s.kind, "id": s.record_id, "role": s.role,
                    "owner": {"id": s.owner_id, "username": s.owner.get_username()},
                    "title": _title_of(s.owner, s.kind, s.record_id), "createdAt": s.created_at.isoformat()})
    return JsonResponse({"shared": out})


# ---------- public links ----------
def _public_dir(link):
    return settings.MEDIA_ROOT / "public" / str(link.pk)


def link_json(request, link):
    base = emails.origin(request)
    return {
        "noteId": link.note_id, "token": link.token, "url": f"{base}/s/{link.token}", "path": f"/s/{link.token}",
        "title": link.title, "views": link.views, "revoked": link.revoked, "hasPassword": bool(link.password_hash),
        "allowDownload": link.allow_download, "hasPdf": link.assets.filter(key="pdf").exists(),
        "expiresAt": int(link.expires_at.timestamp() * 1000) if link.expires_at else None,
        "updatedAt": int(link.updated_at.timestamp() * 1000), "pages": json.loads(link.pages or "[]"),
    }


def _new_token():
    return secrets.token_urlsafe(18)


@api(("GET", "POST", "DELETE"))
def public_link(request):
    me = request.user
    if request.method == "GET":
        link = PublicLink.objects.filter(owner=me, note_id=request.GET.get("noteId", "")).first()
        return JsonResponse({"link": link_json(request, link) if link else None})
    if request.method == "DELETE":
        link = PublicLink.objects.filter(owner=me, note_id=request.GET.get("noteId", "")).first()
        if not link:
            return err("not found", 404)
        link.revoked = True
        link.save(update_fields=["revoked"])
        audit(request, "public.revoke", me, link.note_id)
        return JsonResponse({"ok": True, "link": link_json(request, link)})
    b = parse_json(request) or {}
    note_id = str(b.get("noteId") or "")
    snap = b.get("snapshot") or {}
    if not note_id or not isinstance(snap, dict):
        return err("noteId and snapshot are required")
    if not Profile.of(me).email_verified:
        return err("confirm your e-mail address first", 403)
    pages = []
    for p in (snap.get("pages") or [])[: settings.PUBLIC_MAX_PAGES]:
        if isinstance(p, dict) and KEY_RE.match(str(p.get("key", ""))):
            pages.append({"key": p["key"], "w": int(p.get("w") or 0), "h": int(p.get("h") or 0)})
    text = str(snap.get("text") or "")
    if len(text.encode("utf-8")) > settings.PUBLIC_MAX_TEXT_BYTES:
        return err("note text is too large to publish", 413)
    link, created = PublicLink.objects.get_or_create(owner=me, note_id=note_id, defaults={"token": _new_token()})
    if not created and (link.revoked or b.get("regenerate")):
        link.token = _new_token()
        link.revoked = False
        link.views = 0 if link.revoked else link.views
    link.revoked = False
    link.title = str(snap.get("title") or "")[:300]
    link.text_html = sanitize_html(text, settings.PUBLIC_MAX_TEXT_BYTES)
    link.pages = json.dumps(pages)
    link.allow_download = bool(b.get("allowDownload"))
    if "password" in b:  # None/absent keeps; "" removes
        link.password_hash = make_password(str(b["password"])) if b["password"] else ""
    if "expiresAt" in b:
        link.expires_at = datetime.fromtimestamp(int(b["expiresAt"]) / 1000, dtz.utc) if b["expiresAt"] else None
    from django.utils import timezone

    link.updated_at = timezone.now()
    link.save()
    keep = {p["key"] for p in pages} | ({"pdf"} if snap.get("hasPdf") else set())
    for a in link.assets.exclude(key__in=keep):  # live update: drop stale images
        try:
            os.remove(_public_dir(link) / a.key)
        except OSError:
            pass
        a.delete()
    audit(request, "public.publish", me, f"{note_id}{' (new)' if created else ''}")
    return JsonResponse({"link": link_json(request, link)}, status=201 if created else 200)


@api(("PUT",))
def public_asset(request, token, key):
    link = PublicLink.objects.filter(owner=request.user, token=token).first()
    if not link or not KEY_RE.match(key):
        return err("not found", 404)
    cl = request.META.get("CONTENT_LENGTH")
    if cl is None or not cl.isdigit():
        return err("Content-Length required", 411)
    size = int(cl)
    if size > settings.PUBLIC_MAX_ASSET_BYTES:
        return err("file too large", 413)
    mime = (request.META.get("CONTENT_TYPE") or "").split(";")[0].strip().lower()
    if mime not in ("image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/pdf"):
        return err("unsupported type", 415)
    ex = PublicAsset.objects.filter(link=link, key=key).first()
    q = Profile.of(request.user).quota_bytes()
    used = quota.used_bytes(request.user) - (ex.size if ex else 0)
    if q and used + size > q:
        return err("storage quota exceeded", 413)
    d = _public_dir(link)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (key + ".part")
    written = 0
    with open(tmp, "wb") as f:
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
    os.replace(tmp, d / key)
    PublicAsset.objects.update_or_create(link=link, key=key, defaults={"mime": mime, "size": written})
    return JsonResponse({"ok": True, "size": written})


def purge_link_files(link):
    shutil.rmtree(_public_dir(link), ignore_errors=True)


__all__ = ["check_password"]
