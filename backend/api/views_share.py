"""Sharing with specific users (viewer/editor) and public-link management."""
import json
import os
import re
import secrets
import shutil
from datetime import datetime, timezone as dtz

from django.utils import timezone

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.http import JsonResponse

from . import access, emails, quota, runtime, validate
from .audit import audit
from .models import AbuseReport, PendingInvite, Profile, PublicAsset, PublicLink, Record, Share, UserBlock, now_ms
from .sanitize import sanitize_html
from .util import api, err, hit, parse_json, public_user

User = get_user_model()
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
NOT_FOUND = "not found"


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
def _role(v, default="viewer"):
    v = str(v or default).lower()
    return {"read": "viewer", "viewer": "viewer", "write": "editor", "editor": "editor"}.get(v)


def _ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


def _dt(ms):
    return datetime.fromtimestamp(int(ms) / 1000, dtz.utc) if ms else None


def _share_json(s, with_recipient=True):
    d = {"id": s.uid, "kind": s.kind, "recordId": s.record_id, "role": s.role, "permission": "write" if s.role == "editor" else "read",
         "expiresAt": _ms(s.expires_at), "viaLink": s.via_link, "createdAt": s.created_at.isoformat()}
    if with_recipient:
        d["recipient"] = {**public_user(s.recipient), "email": s.recipient.email}  # owner typed this address themselves
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
    role = _role(b.get("role") or b.get("permission"))
    email = str(b.get("email") or "").strip().lower()
    if kind not in ("notes", "notebooks") or not role or not rid:
        return err("invalid request")
    if not hit(f"share:{me.pk}", settings.SHARE_RATE_LIMIT, 3600) or not hit(f"inv-d:{me.pk}", settings.INVITES_PER_DAY, 86400):
        return err("too many invitations, try again later", 429)
    if email and not hit(f"inv-a:{me.pk}:{email}", settings.INVITES_PER_ADDRESS_DAILY, 86400):
        return JsonResponse({"ok": True, "pending": True, "message": "If that person has an account they will be notified."}, status=202)
    if not Record.objects.filter(user=me, kind=kind, record_id=rid, deleted=False).exists():
        return err("sync this item before sharing it", 409)
    target = User.objects.filter(email=email, is_active=True).first() if email else None
    if target and UserBlock.objects.filter(blocker=target, blocked=me).exists():
        target = None  # the recipient blocked you: indistinguishable from "no such account"
    if not target:  # uniform answer; invitation is claimed if/when that address signs up
        if email and "@" in email:
            PendingInvite.objects.get_or_create(owner=me, email=email[:254], kind=kind, record_id=rid, defaults={"role": role})
        return JsonResponse({"ok": True, "pending": True, "message": "If that person has an account they will be notified."}, status=202)
    if target.pk == me.pk:
        return JsonResponse({"ok": True, "pending": True}, status=202)
    s, created = Share.objects.update_or_create(owner=me, recipient=target, kind=kind, record_id=rid,
                                                defaults={"role": role, "expires_at": _dt(b.get("expiresAt")), "via_link": False})
    access.bump(me.pk, kind, rid)
    audit(request, "share.add", me, f"{kind}:{rid} -> {target.email} ({role})")
    _activity(me, rid, kind, "shared", me)
    if created and target.email and settings.SMTP_ENABLED:
        emails.send_share(request, me, target, _title_of(me, kind, rid), role)
    return JsonResponse({"share": _share_json(s)}, status=201 if created else 200)


def _activity(owner, rid, kind, action, actor):
    if kind == "notes":
        from .models import ActivityEvent

        ActivityEvent.objects.create(owner_id=owner.pk, note_id=rid, actor=actor, action=action)


@api(("DELETE", "POST", "PATCH"))
def person(request, share_id):
    """Owner revokes / changes role; a recipient may remove themselves (leave). Others get the same 404."""
    s = Share.objects.filter(uid=str(share_id)[:32]).first()
    if not s or me_not_involved(request.user, s):
        return err("not found", 404)
    if request.method == "DELETE":
        s.delete()
        audit(request, "share.revoke", request.user, f"{s.kind}:{s.record_id}")
        return JsonResponse({"ok": True})
    if s.owner_id != request.user.pk:
        return err("forbidden", 403)
    b = parse_json(request) or {}
    role = _role(b.get("role") or b.get("permission"), s.role)
    if not role:
        return err("invalid role")
    s.role = role
    if "expiresAt" in b:
        s.expires_at = _dt(b["expiresAt"])
    s.save()
    _activity(s.owner, s.record_id, s.kind, "permissions-changed", request.user)
    return JsonResponse({"share": _share_json(s)})


def me_not_involved(user, s):
    return user.pk not in (s.owner_id, s.recipient_id)


@api(("GET",))
def shared_with_me(request):
    out = []
    for s in access._live(Share.objects.filter(recipient=request.user)).select_related("owner"):
        out.append({"shareId": s.pk, "kind": s.kind, "id": s.record_id, "role": s.role, "permission": "write" if s.role == "editor" else "read", "expiresAt": _ms(s.expires_at),
                    "owner": public_user(s.owner),
                    "title": _title_of(s.owner, s.kind, s.record_id), "createdAt": s.created_at.isoformat()})
    return JsonResponse({"shared": out})


# ---------- public links ----------
def _public_dir(link):
    return settings.MEDIA_ROOT / "public" / str(link.pk)


def link_json(request, link):
    base = emails.origin(request)
    return {
        "noteId": link.note_id, "id": link.uid, "token": link.token, "url": f"{base}/s/{link.token}", "path": f"/s/{link.token}",
        "kind": link.kind, "visibility": link.visibility, "permission": link.permission, "edits": link.edits,
        "expired": bool(link.expires_at and link.expires_at <= timezone.now()),
        "title": link.title, "views": link.views, "revoked": link.revoked, "hasPassword": bool(link.password_hash),
        "allowDownload": link.allow_download, "hasPdf": link.assets.filter(key="pdf").exists(),
        "expiresAt": int(link.expires_at.timestamp() * 1000) if link.expires_at else None,
        "updatedAt": int(link.updated_at.timestamp() * 1000), "pages": json.loads(link.pages or "[]"),
    }


def _vis(v, default="public"):
    v = str(v or default).lower()
    return v if v in ("private", "internal", "public") else None


@api(("GET", "POST", "DELETE"))
def public_link(request):
    me = request.user
    kind = request.GET.get("kind", "notes")
    if request.method == "GET":
        link = PublicLink.objects.filter(owner=me, kind=kind, note_id=request.GET.get("noteId", "")).first()
        return JsonResponse({"link": link_json(request, link) if link else None})
    if request.method == "DELETE":
        link = PublicLink.objects.filter(owner=me, kind=kind, note_id=request.GET.get("noteId", "")).first()
        if not link:
            return err("not found", 404)
        link.revoked = True
        link.save(update_fields=["revoked"])
        audit(request, "public.revoke", me, link.note_id)
        return JsonResponse({"ok": True, "link": link_json(request, link)})
    b = parse_json(request) or {}
    kind = b.get("kind", "notes")
    note_id = str(b.get("noteId") or "")
    snap = b.get("snapshot") or {}
    if kind not in ("notes", "notebooks") or not note_id or not isinstance(snap, dict):
        return err("noteId and snapshot are required")
    if not Profile.of(me).email_verified:
        return err("confirm your e-mail address first", 403)
    vis = _vis(b.get("visibility"))
    perm = "write" if str(b.get("permission", "read")).lower() in ("write", "editor") else "read"
    if not vis:
        return err("invalid visibility")
    if vis == "public" and not runtime.anonymous_links_allowed():
        return err("anonymous public links are disabled on this server; use 'internal' (sign-in required)", 403)
    if vis == "public" and perm == "write":
        vis = "internal"  # editing always needs an account
    pages = []
    for p in (snap.get("pages") or [])[: settings.PUBLIC_MAX_PAGES]:
        if isinstance(p, dict) and KEY_RE.match(str(p.get("key", ""))):
            pages.append({"key": p["key"], "w": int(p.get("w") or 0), "h": int(p.get("h") or 0)})
    text = str(snap.get("text") or "")
    if len(text.encode("utf-8")) > settings.PUBLIC_MAX_TEXT_BYTES:
        return err("note text is too large to publish", 413)
    if not hit(f"linkmk:{me.pk}", 60, 3600):
        return err("too many link changes, try again later", 429)
    if not Record.objects.filter(user=me, kind=kind, record_id=note_id).exists():
        return err("sync this item before publishing it", 409)
    link, created = PublicLink.objects.get_or_create(owner=me, kind=kind, note_id=note_id)
    if not created and (link.revoked or b.get("regenerate")):
        link.rotate()
        if link.revoked:
            link.views = link.edits = 0
    link.revoked = False
    link.visibility, link.permission = vis, perm
    link.title = str(snap.get("title") or "")[:300]
    link.text_html = sanitize_html(text, settings.PUBLIC_MAX_TEXT_BYTES)
    link.pages = json.dumps(pages)
    link.allow_download = bool(b.get("allowDownload"))
    if "password" in b:  # None/absent keeps; "" removes
        link.password_hash = make_password(str(b["password"])) if b["password"] else ""
    if "expiresAt" in b:
        link.expires_at = _dt(b["expiresAt"])
    link.updated_at = timezone.now()
    link.save()
    keep = {p["key"] for p in pages} | ({"pdf"} if snap.get("hasPdf") else set())
    for a in link.assets.exclude(key__in=keep):  # live update: drop stale images
        try:
            os.remove(_public_dir(link) / a.key)
        except OSError:
            pass
        a.delete()
    audit(request, "public.publish", me, f"{kind}:{note_id}{' (new)' if created else ''} {vis}/{perm}")
    return JsonResponse({"link": link_json(request, link)}, status=201 if created else 200)


@api(("GET",), auth=False)
def link_info(request):
    """Minimal, unauthenticated facts about a link so the app can show a sign-in / password prompt."""
    link = PublicLink.by_token(request.GET.get("token", ""))
    if not link or link.revoked or link.visibility == "private" or (link.expires_at and link.expires_at <= timezone.now()):
        return err("this link is not available", 404)
    return JsonResponse({"kind": link.kind, "permission": link.permission, "visibility": link.visibility,
                         "hasPassword": bool(link.password_hash), "owner": public_user(link.owner),
                         "title": "" if link.password_hash else link.title})


@api(("POST",))
def link_redeem(request):
    """Accept a link-share: creates a Share for the signed-in user so the note syncs into their library."""
    b = parse_json(request) or {}
    me = request.user
    link = PublicLink.by_token(b.get("token"))
    if not hit(f"redeem:{me.pk}", 30, 600):
        return err("too many attempts, try again later", 429)
    if not link or link.revoked or link.visibility == "private" or (link.expires_at and link.expires_at <= timezone.now()):
        return err("this link is not available", 404)
    if link.password_hash:
        if not hit(f"linkpw:{me.pk}:{link.pk}", settings.PUBLIC_PASSWORD_ATTEMPTS, 600):
            return err("too many attempts, try again later", 429)
        if not check_password(str(b.get("password") or ""), link.password_hash):
            return err("incorrect password", 403)
    if link.owner_id == me.pk:
        return JsonResponse({"kind": link.kind, "id": link.note_id, "own": True})
    role = "editor" if link.permission == "write" else "viewer"
    s, created = Share.objects.get_or_create(owner=link.owner, recipient=me, kind=link.kind, record_id=link.note_id,
                                             defaults={"role": role, "via_link": True, "expires_at": link.expires_at})
    if not created and s.via_link and s.role != role:
        s.role = role
        s.save()
    if created:
        access.bump(link.owner_id, link.kind, link.note_id)
    PublicLink.objects.filter(pk=link.pk).update(views=link.views + 1)
    audit(request, "share.redeem", me, f"{link.kind}:{link.note_id} {role}")
    return JsonResponse({"kind": link.kind, "id": link.note_id, "role": role, "owner": public_user(link.owner)["name"], "title": link.title})


@api(("PUT",))
def public_asset(request, token, key):
    link = PublicLink.by_token(token)
    if not link or link.owner_id != request.user.pk or not KEY_RE.match(key):
        return err("not found", 404)
    cl = request.META.get("CONTENT_LENGTH")
    if cl is None or not cl.isdigit():
        return err("Content-Length required", 411)
    size = int(cl)
    if size > settings.PUBLIC_MAX_ASSET_BYTES:
        return err("file too large", 413)
    mime = (request.META.get("CONTENT_TYPE") or "").split(";")[0].strip().lower()
    if mime not in ("image/png", "image/jpeg", "image/webp", "application/pdf"):  # never SVG/HTML from users
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
    first = request.read(16)
    if validate.sniff(first) != mime:
        return err("file content does not match its type", 415)
    with open(tmp, "wb") as f:
        f.write(first)
        written = len(first)
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


# ---------- blocking and abuse reports ----------
@api(("POST", "DELETE", "GET"))
def blocks(request):
    me = request.user
    if request.method == "GET":
        return JsonResponse({"blocked": [public_user(b.blocked) for b in UserBlock.objects.filter(blocker=me).select_related("blocked")]})
    b = parse_json(request) or {}
    target = User.objects.filter(public_id=str(b.get("userId") or "")[:32]).first()
    if not target or target.pk == me.pk:
        return err(NOT_FOUND, 404)
    if request.method == "DELETE":
        UserBlock.objects.filter(blocker=me, blocked=target).delete()
    else:
        UserBlock.objects.get_or_create(blocker=me, blocked=target)
        Share.objects.filter(owner=target, recipient=me).delete()  # drop what they shared with me
    return JsonResponse({"ok": True})


@api(("POST",))
def report_abuse(request):
    b = parse_json(request) or {}
    if not hit(f"report:{request.user.pk}", 10, 3600):
        return err("too many reports, try again later", 429)
    target, kind, ref = None, str(b.get("kind") or "user"), ""
    if kind == "link":
        link = PublicLink.by_token(b.get("token"))
        target, ref = (link.owner, link.uid) if link else (None, "")
    else:
        target = User.objects.filter(public_id=str(b.get("userId") or "")[:32]).first()
        kind = "user"
    AbuseReport.objects.create(reporter=request.user, target=target, kind=kind, ref=ref, reason=validate.plain(b.get("reason") or "", 500))
    return JsonResponse({"ok": True})  # same answer whatever the target was
