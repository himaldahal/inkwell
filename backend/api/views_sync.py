import json

from django.conf import settings
from django.db import transaction
from django.db.models import F, Max
from django.http import HttpResponse, JsonResponse

from .models import KINDS, AssetBlob, Record, SeqCounter, now_ms
from .util import api, err, parse_json
from .views_assets import delete_blob_file

FUTURE_SKEW_MS = 5 * 60 * 1000


def _rec_json(r):
    try:
        data = json.loads(r.data)
    except ValueError:
        data = {}
    return {"kind": r.kind, "id": r.record_id, "updatedAt": r.updated_at, "deleted": r.deleted, "seq": r.seq, "data": data}


@api(("GET",), auth=False)
def health(request):
    from django.db import connection

    try:
        with connection.cursor() as c:
            c.execute("SELECT 1")
        return JsonResponse({"ok": True, "time": now_ms(), "registration": settings.ALLOW_REGISTRATION})
    except Exception:  # noqa: BLE001
        return JsonResponse({"ok": False}, status=503)


@api(("GET",))
def pull(request):
    try:
        since = max(0, int(request.GET.get("since", 0)))
        limit = min(max(1, int(request.GET.get("limit", settings.PULL_PAGE_SIZE))), 1000)
    except ValueError:
        return err("bad parameters")
    top = Record.objects.filter(user=request.user).aggregate(m=Max("seq"))["m"] or 0
    etag = f'"{request.user.pk}-{since}-{top}-{limit}"'
    if request.headers.get("If-None-Match") == etag:
        r = HttpResponse(status=304)
        r["ETag"] = etag
        return r
    qs = Record.objects.filter(user=request.user, seq__gt=since).order_by("seq")[: limit + 1]
    rows = list(qs)
    out, size, has_more = [], 0, False
    for i, r in enumerate(rows):
        if i >= limit or (out and size > settings.PULL_MAX_BYTES):
            has_more = True
            break
        size += len(r.data)
        out.append(_rec_json(r))
    cursor = out[-1]["seq"] if out else since
    resp = JsonResponse({"records": out, "cursor": cursor, "hasMore": has_more, "serverTime": now_ms()})
    resp["ETag"] = etag
    resp["Cache-Control"] = "private, no-cache"
    return resp


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

    user = request.user
    accepted, conflicts, rejected = [], [], []
    removed_blobs = []
    with transaction.atomic():
        # take the write lock first, then read the counter
        SeqCounter.objects.get_or_create(pk=1)
        SeqCounter.objects.filter(pk=1).update(value=F("value") + len(records))
        top = SeqCounter.objects.get(pk=1).value
        seq = top - len(records)
        now = now_ms()
        for rec in records:
            seq += 1
            try:
                kind, rid = rec["kind"], str(rec["id"])
                ua = int(rec["updatedAt"])
                deleted = bool(rec.get("deleted"))
                data = rec.get("data") or {}
                if kind not in KINDS or not (0 < len(rid) <= 64) or not isinstance(data, dict):
                    raise ValueError
            except (KeyError, TypeError, ValueError):
                rejected.append({"id": str(rec.get("id", "")) if isinstance(rec, dict) else "", "error": "invalid record"})
                continue
            ua = min(ua, now + FUTURE_SKEW_MS)
            data.pop("blob", None)
            data.pop("dirty", None)
            raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
            if len(raw) > settings.MAX_RECORD_BYTES:
                rejected.append({"kind": kind, "id": rid, "error": "record too large"})
                continue
            ex = Record.objects.filter(user=user, kind=kind, record_id=rid).first()
            if ex:
                newer = ex.updated_at > ua or (ex.updated_at == ua and ex.deleted and not deleted)
                if newer:
                    conflicts.append(_rec_json(ex))
                    continue
                if ex.updated_at == ua and ex.deleted == deleted and ex.data == raw:
                    accepted.append({"kind": kind, "id": rid, "seq": ex.seq, "updatedAt": ua})
                    continue
                ex.updated_at, ex.deleted, ex.data, ex.seq = ua, deleted, raw, seq
                ex.save()
            else:
                Record.objects.create(user=user, kind=kind, record_id=rid, updated_at=ua, deleted=deleted, seq=seq, data=raw)
            if kind == "assets" and deleted:
                removed_blobs.append(rid)
            accepted.append({"kind": kind, "id": rid, "seq": seq, "updatedAt": ua})
        for aid in removed_blobs:
            delete_blob_file(user, aid)
    return JsonResponse(
        {"accepted": accepted, "conflicts": conflicts, "rejected": rejected, "cursor": top, "serverTime": now_ms()}
    )
