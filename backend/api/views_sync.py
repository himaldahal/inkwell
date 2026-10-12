import hashlib
import json

from django.conf import settings
from django.db import transaction
from django.db.models import F, Max
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from django.contrib.auth import get_user_model

from . import access, trash, validate
from .models import KINDS, Profile, PublicLink, Record, Share, now_ms
from .util import api, dec_cursor, enc_cursor, err, parse_json
from .views_assets import delete_blob_file

FUTURE_SKEW_MS = 5 * 60 * 1000


def _rec_json(r, me=None, owners=None):  # noqa: C901
    try:
        data = json.loads(r.data)
    except ValueError:
        data = {}
    out = {"kind": r.kind, "id": r.record_id, "updatedAt": r.updated_at, "deleted": r.deleted, "seq": r.seq, "data": data}
    if me is not None and r.user_id != me.pk:
        if owners is not None and r.user_id not in owners:
            owners[r.user_id] = r.user.get_username()
        out["ownerId"] = r.user.public_id
        out["owner"] = r.user.display
        out["role"] = access.role_for(me, r.user_id, r.kind, r.record_id, r.parent_id)
    return out


def _parent(kind, data):
    if data.get("enc"):
        return ""
    if kind == "notes":
        return str(data.get("notebookId") or "")[:64]
    if kind == "assets":
        return str(data.get("noteId") or "")[:64]
    return ""


@api(("GET",), auth=False)
def health(request):
    from django.db import connection

    try:
        with connection.cursor() as c:
            c.execute("SELECT 1")
        return JsonResponse({"ok": True, "time": now_ms(), "registration": settings.ALLOW_REGISTRATION})
    except Exception:  # noqa: BLE001
        return JsonResponse({"ok": False}, status=503)


def _do_pull(request):
    trash.maybe_cleanup()
    try:
        since = dec_cursor(request.user, request.GET.get("since"))
        limit = min(max(1, int(request.GET.get("limit", settings.PULL_PAGE_SIZE))), 1000)
    except ValueError:
        return err("bad parameters")
    vis = access.visible_q(request.user)
    top = Record.objects.filter(vis).aggregate(m=Max("seq"))["m"] or 0
    sig = access.shares_signature(request.user)
    etag = '"' + hashlib.sha256(f"{request.user.pk}:{since}:{top}:{limit}:{sig}:{settings.SECRET_KEY}".encode()).hexdigest()[:24] + '"'
    if request.headers.get("If-None-Match") == etag:
        r = HttpResponse(status=304)
        r["ETag"] = etag
        return r
    rows = list(Record.objects.filter(vis, seq__gt=since).select_related("user").order_by("seq")[: limit + 1])
    out, size, has_more, owners = [], 0, False, {}
    for i, r in enumerate(rows):
        if i >= limit or (out and size > settings.PULL_MAX_BYTES):
            has_more = True
            break
        size += len(r.data)
        out.append(_rec_json(r, request.user, owners))
    cursor = enc_cursor(request.user, out[-1]["seq"] if out else since)
    body = {"records": out, "cursor": cursor, "hasMore": has_more, "serverTime": now_ms()}
    if not has_more:  # authoritative list of what is currently shared with me (lets clients drop revoked shares)
        body["shared"] = [{"kind": s.kind, "id": s.record_id, "ownerId": s.owner.public_id, "role": s.role}
                          for s in access._live(Share.objects.filter(recipient=request.user)).select_related("owner")]
    resp = JsonResponse(body)
    resp["ETag"] = etag
    resp["Cache-Control"] = "private, no-cache"
    return resp


@api(("GET",))
def pull(request):
    return _do_pull(request)


@api(("GET",))
def wait(request):
    """Optional long poll (LONGPOLL=1): returns as soon as something new is visible, or after a timeout (304)."""
    if not settings.LONGPOLL:
        return err("long polling is disabled on this server", 501)
    import time

    try:
        since = dec_cursor(request.user, request.GET.get("since"))
        timeout = min(int(request.GET.get("timeout", 20)), settings.LONGPOLL_MAX_SECONDS)
    except ValueError:
        return err("bad parameters")
    sig0 = access.shares_signature(request.user)
    end = time.time() + timeout
    while time.time() < end:
        top = Record.objects.filter(access.visible_q(request.user)).aggregate(m=Max("seq"))["m"] or 0
        if top > since or access.shares_signature(request.user) != sig0:
            break
        time.sleep(1)
    return _do_pull(request)


@api(("POST",))
def push(request):
    cl = int(request.META.get("CONTENT_LENGTH") or 0)
    if cl > settings.MAX_PUSH_BYTES:
        return err("payload too large", 413)
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    records = b.get("records")
    if not isinstance(records, list):
        return err("records must be a list")
    if len(records) > settings.MAX_PUSH_RECORDS:
        return err(f"max {settings.MAX_PUSH_RECORDS} records per push", 413)

    me = request.user
    User = get_user_model()
    profile = Profile.of(me)
    note_limit = profile.note_limit()
    accepted, conflicts, rejected = [], [], []
    removed_blobs = []
    with transaction.atomic():
        seq = access.next_seqs(len(records)) - 1
        top = seq + len(records)
        now = now_ms()
        for rec in records:
            seq += 1
            try:
                kind, rid = rec["kind"], str(rec["id"])
                ua = int(rec["updatedAt"])
                deleted = bool(rec.get("deleted"))
                data = rec.get("data") or {}
                owner_id = me.pk
                if rec.get("ownerId"):
                    ou = User.objects.filter(public_id=str(rec["ownerId"])[:32]).first()
                    owner_id = ou.pk if ou else 0
                if kind not in KINDS or not validate.ID_RE.match(rid) or not isinstance(data, dict):
                    raise ValueError
            except (KeyError, TypeError, ValueError, AttributeError):
                rejected.append({"id": str(rec.get("id", "")) if isinstance(rec, dict) else "", "error": "invalid record"})
                continue
            ua = min(ua, now + FUTURE_SKEW_MS)
            try:
                data = validate.clean_record(kind, data)
            except ValueError as e:
                rejected.append({"kind": kind, "id": rid, "error": str(e)})
                continue
            raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
            if len(raw) > settings.MAX_RECORD_BYTES:
                rejected.append({"kind": kind, "id": rid, "error": "record too large"})
                continue
            parent = _parent(kind, data)
            ex = Record.objects.filter(user_id=owner_id, kind=kind, record_id=rid).first()
            if owner_id == 0:
                rejected.append({"kind": kind, "id": rid, "error": "forbidden"})
                continue
            if owner_id != me.pk:  # writing into someone else's space: needs an editor share
                role = access.role_for(me, owner_id, kind, rid, parent if not ex else ex.parent_id)
                if role == "viewer" or role is None:
                    if ex and role:
                        c = _rec_json(ex, me)
                        c["force"] = True  # client must discard its local edit
                        conflicts.append(c)
                    else:
                        rejected.append({"kind": kind, "id": rid, "error": "forbidden"})
                    continue
                if ex is None and kind == "assets":
                    pass
            elif ex is None and kind == "notes" and not deleted and note_limit:
                if Record.objects.filter(user=me, kind="notes", deleted=False).count() >= note_limit:
                    rejected.append({"kind": kind, "id": rid, "error": f"note limit reached ({note_limit})"})
                    continue
            if ex:
                newer = ex.updated_at > ua or (ex.updated_at == ua and ex.deleted and not deleted)
                if newer:
                    conflicts.append(_rec_json(ex, me))
                    continue
                if ex.updated_at == ua and ex.deleted == deleted and ex.data == raw:
                    accepted.append({"kind": kind, "id": rid, "seq": ex.seq, "updatedAt": ua})
                    continue
                ex.updated_at, ex.deleted, ex.data, ex.seq, ex.parent_id = ua, deleted, raw, seq, parent
                ex.deleted_at = (ex.deleted_at or timezone.now()) if deleted else None
                ex.save()
            else:
                Record.objects.create(user_id=owner_id, kind=kind, record_id=rid, updated_at=ua, deleted=deleted, seq=seq,
                                      parent_id=parent, data=raw, deleted_at=timezone.now() if deleted else None)
            if owner_id != me.pk and kind == "notes":
                PublicLink.objects.filter(owner_id=owner_id, kind="notes", note_id=rid).update(edits=F("edits") + 1)
            if kind == "assets" and deleted:
                removed_blobs.append((owner_id, rid))
            accepted.append({"kind": kind, "id": rid, "seq": seq, "updatedAt": ua})
        for oid, aid in removed_blobs:
            delete_blob_file(User(pk=oid), aid)
    return JsonResponse(
        {"accepted": accepted, "conflicts": conflicts, "rejected": rejected, "cursor": enc_cursor(me, top), "serverTime": now_ms()}
    )
