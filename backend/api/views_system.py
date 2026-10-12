"""Superuser system panel: analytics, API stats, server info, roles, read-only data viewer. All views declare an RBAC permission."""
import json
import os
import platform
import sys
import time
from datetime import date, timedelta

import django
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.db.models import Avg, Count, Q, Sum
from django.db.models.functions import Length, TruncDate
from django.http import JsonResponse
from django.utils import timezone

from . import rbac, runtime
from .audit import audit
from .models import (AbuseReport, ActiveDay, ActivityEvent, ApiStat, AssetBlob, AuditLog, Block, Device, LoginEvent, MailQueue, Presence, Profile,
                     PublicLink, Record, Role, Share, now_ms)
from .util import api, err, parse_json

User = get_user_model()
STARTED = time.time()
PAGE = 50


def _days(request, default=30):
    try:
        return max(1, min(365, int(request.GET.get("days", default))))
    except ValueError:
        return default


def _per_day(qs, field, days):
    since = timezone.now() - timedelta(days=days - 1)
    by = {r["d"]: r["n"] for r in qs.filter(**{f"{field}__gte": since}).annotate(d=TruncDate(field)).values("d").annotate(n=Count("id"))}
    today = timezone.now().date()
    return [{"date": str(today - timedelta(days=i)), "n": by.get(today - timedelta(days=i), 0)} for i in range(days - 1, -1, -1)]


def _active_sets(days):
    since = timezone.now().date() - timedelta(days=days + 30)
    sets = {}
    for uid, d in ActiveDay.objects.filter(day__gte=since).values_list("user_id", "day"):
        sets.setdefault(d, set()).add(uid)
    return sets


def _compute(days):
    now = timezone.now()
    today = now.date()
    act = _active_sets(days)

    def window(d, n):
        out = set()
        for i in range(n):
            out |= act.get(d - timedelta(days=i), set())
        return len(out)

    series = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    active = [{"date": str(d), "dau": len(act.get(d, ())), "wau": window(d, 7), "mau": window(d, 30)} for d in series]
    total_users = User.objects.count()
    base = User.objects.filter(date_joined__lt=now - timedelta(days=days)).count()
    growth, run = [], base
    for s in _per_day(User.objects, "date_joined", days):
        run += s["n"]
        growth.append({"date": s["date"], "n": run, "new": s["n"]})
    # weekly retention cohorts (last 8 signup weeks, weeks 0..4 later)
    cohorts = []
    for w in range(7, -1, -1):
        start = today - timedelta(days=today.weekday() + 7 * w)
        ids = set(User.objects.filter(date_joined__date__gte=start, date_joined__date__lt=start + timedelta(days=7)).values_list("id", flat=True))
        row = {"week": str(start), "size": len(ids), "retained": []}
        for k in range(5):
            a, b = start + timedelta(days=7 * k), start + timedelta(days=7 * k + 7)
            if a > today:
                row["retained"].append(None)
                continue
            seen = set()
            for d in (a + timedelta(days=i) for i in range(7)):
                seen |= act.get(d, set()) & ids
            row["retained"].append(round(100 * len(seen) / len(ids)) if ids else None)
        cohorts.append(row)
    notes = Record.objects.filter(kind="notes", deleted=False)
    sample = list(notes.exclude(data__startswith='{"enc"').order_by("-updated_at").values_list("data", flat=True)[:2000])
    pages = strokes = items = 0
    created = {}
    for raw in sample:
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        pg = d.get("pages") or []
        pages += len(pg)
        for p in pg:
            strokes += len(p.get("strokes") or [])
            items += len(p.get("items") or [])
        c = d.get("createdAt")
        if isinstance(c, (int, float)) and c > 0:
            day = date.fromtimestamp(c / 1000)
            created[day] = created.get(day, 0) + 1
    kinds = {}
    for mime, n, size in AssetBlob.objects.values_list("mime").annotate(n=Count("id"), s=Sum("size")):
        fam = "pdf" if "pdf" in mime else mime.split("/")[0] if "/" in mime else "other"
        k = kinds.setdefault(fam, {"count": 0, "bytes": 0})
        k["count"] += n
        k["bytes"] += size or 0
    top = [{"user": r["user__email"], "bytes": r["b"], "files": r["n"]} for r in
           AssetBlob.objects.values("user__email").annotate(b=Sum("size"), n=Count("id")).order_by("-b")[:10]]
    dev = lambda f: list(Device.objects.exclude(**{f: ""}).values(f).annotate(n=Count("id")).order_by("-n")[:12])  # noqa: E731
    since = now - timedelta(days=days)
    mail = {r["status"]: r["n"] for r in MailQueue.objects.filter(created_at__gte=since).values("status").annotate(n=Count("id"))}
    return {
        "days": days, "users": {"total": total_users, "verified": Profile.objects.filter(email_verified=True).count(), "disabled": User.objects.filter(is_active=False).count(),
                                "e2e": Record.objects.filter(kind="notes", data__startswith='{"enc"').count(), "mode": settings.DEPLOYMENT_MODE},
        "growth": growth, "active": active, "cohorts": cohorts,
        "signups": _per_day(User.objects, "date_joined", days),
        "logins": _per_day(LoginEvent.objects.filter(ok=True, event="login"), "created_at", days),
        "failed": _per_day(LoginEvent.objects.filter(ok=False), "created_at", days),
        "devices": {"browser": dev("browser"), "os": dev("os"), "kind": dev("kind")},
        "content": {"notes": notes.count(), "notebooks": Record.objects.filter(kind="notebooks", deleted=False).count(), "sampled": len(sample), "pages": pages,
                    "strokes": strokes, "items": items, "avgNoteBytes": int(notes.aggregate(a=Avg(Length("data")))["a"] or 0),
                    "createdPerDay": [{"date": str(today - timedelta(days=i)), "n": created.get(today - timedelta(days=i), 0)} for i in range(days - 1, -1, -1)]},
        "storage": {"total": AssetBlob.objects.aggregate(s=Sum("size"))["s"] or 0, "byKind": kinds, "top": top},
        "sharing": {"shares": Share.objects.count(), "links": PublicLink.objects.filter(revoked=False).count(), "views": PublicLink.objects.aggregate(s=Sum("views"))["s"] or 0,
                    "edits": PublicLink.objects.aggregate(s=Sum("edits"))["s"] or 0},
        "collab": {"presenceNow": Presence.objects.filter(updated_at__gte=now - timedelta(seconds=15)).count(),
                   "activityPerDay": _per_day(ActivityEvent.objects, "created_at", days)},
        "mail": mail, "abuse": {"blocks": Block.objects.count(), "openReports": AbuseReport.objects.filter(status="open").count(),
                                "events": _per_day(AuditLog.objects.filter(Q(event__startswith="mail.alert") | Q(event="login_failed")), "created_at", days)},
        "trash": {"records": Record.objects.filter(deleted=True).exclude(data="{}").count(), "retentionDays": settings.TRASH_RETENTION_DAYS,
                  "purges": [{"at": a.created_at.isoformat(), "detail": a.detail} for a in AuditLog.objects.filter(event="trash.purge")[:10]]},
    }


@api(("GET",), perm="analytics.read")
def analytics(request):
    days = _days(request)
    key = f"sys:analytics:{days}"
    data = cache.get(key)
    if data is None:
        data = _compute(days)
        cache.set(key, data, 60)
    return JsonResponse(data)


def _pct(rows, p):
    cols = ("b10", "b50", "b100", "b250", "b500", "b1000", "bmore")
    lim = (10, 50, 100, 250, 500, 1000, 2000)
    tot = sum(sum(r[c] for c in cols) for r in rows)
    if not tot:
        return 0
    acc = 0
    for c, l in zip(cols, lim):
        acc += sum(r[c] for r in rows)
        if acc >= tot * p:
            return l
    return lim[-1]


@api(("GET",), perm="analytics.read")
def api_stats(request):
    hours = _days(request, 2) * 24
    since = int(time.time() // 3600) - hours
    rows = list(ApiStat.objects.filter(hour__gte=since).values())
    ep = {}
    for r in rows:
        if r["endpoint"].startswith("metric:"):
            continue
        e = ep.setdefault(r["endpoint"], {"endpoint": r["endpoint"], "count": 0, "errors": 0, "denied": 0, "ms": 0, "rows": []})
        e["count"] += r["count"]; e["errors"] += r["errors"]; e["denied"] += r["denied"]; e["ms"] += r["ms_sum"]; e["rows"].append(r)
    table = sorted(({"endpoint": e["endpoint"], "count": e["count"], "errorRate": round(100 * e["errors"] / e["count"], 2) if e["count"] else 0,
                     "denied": e["denied"], "avgMs": round(e["ms"] / e["count"]) if e["count"] else 0, "p95Ms": _pct(e["rows"], 0.95)} for e in ep.values()),
                   key=lambda x: -x["count"])
    hourly = {}
    for r in rows:
        h = hourly.setdefault(r["hour"], {"hour": r["hour"] * 3600000, "requests": 0, "errors": 0, "pushes": 0, "pulls": 0})
        if r["endpoint"].startswith("metric:"):
            continue
        h["requests"] += r["count"]; h["errors"] += r["errors"]
        if r["endpoint"].endswith("sync/push"):
            h["pushes"] += r["count"]
        elif r["endpoint"].endswith(("sync/pull", "sync/wait")):
            h["pulls"] += r["count"]
    metric = lambda n: sum(r["count"] for r in rows if r["endpoint"] == "metric:" + n)  # noqa: E731
    sync_rows = [r for r in rows if r["endpoint"].endswith(("sync/push", "sync/pull"))]
    return JsonResponse({"hours": hours, "table": table[:40], "hourly": sorted(hourly.values(), key=lambda x: x["hour"]),
                         "sync": {"conflicts": metric("conflicts"), "rejected": metric("rejected"), "recordsPushed": metric("records_pushed"),
                                  "failures": sum(r["errors"] for r in sync_rows), "p50Ms": _pct(sync_rows, 0.5), "p95Ms": _pct(sync_rows, 0.95), "p99Ms": _pct(sync_rows, 0.99)}})


def _dir_size(path):
    t = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                t += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return t


@api(("GET",), perm="system.read")
def server(request):
    from django.apps import apps

    db = settings.DATABASES["default"]
    counts = {m._meta.label: m.objects.count() for m in apps.get_app_config("api").get_models()}
    try:
        dbsize = os.path.getsize(db["NAME"]) if db["ENGINE"].endswith("sqlite3") else None
    except OSError:
        dbsize = None
    flush, gc = runtime.get("last_mail_flush"), runtime.get("last_trash_gc")
    return JsonResponse({
        "python": platform.python_version(), "django": django.get_version(), "platform": platform.platform(), "uptimeSeconds": int(time.time() - STARTED),
        "db": db["ENGINE"].rsplit(".", 1)[-1], "dbBytes": dbsize, "mediaBytes": _dir_size(settings.MEDIA_ROOT), "tables": counts,
        "flags": {"mode": settings.DEPLOYMENT_MODE, "debug": settings.DEBUG, "smtp": settings.SMTP_ENABLED, "verification": settings.REQUIRE_EMAIL_VERIFICATION,
                  "registration": runtime.registration_open(), "pow": settings.POW_REQUIRED, "longPoll": settings.LONGPOLL, "turn": bool(settings.TURN_URL),
                  "trashDays": settings.TRASH_RETENTION_DAYS, "trustedProxies": bool(settings.TRUSTED_PROXIES)},
        "jobs": {"mailQueued": MailQueue.objects.filter(status="queued").count(), "mailFailed": MailQueue.objects.filter(status="failed").count(),
                 "lastMailFlush": flush, "lastTrashCleanup": gc, "note": "No cron needed: jobs run opportunistically on requests."},
        "serverTime": now_ms(),
    })


# ---------- roles ----------
def _role_json(r):
    return {"id": r.uid, "name": r.name, "builtin": r.builtin, "permissions": sorted(json.loads(r.permissions)),
            "users": Profile.objects.filter(role=r).count() if not r.builtin else None}


@api(("GET", "POST"), perm={"GET": "users.read", "POST": "roles.manage"})
def roles(request):
    rbac.ensure_builtin()
    if request.method == "POST":
        b = parse_json(request) or {}
        name = str(b.get("name") or "").strip()[:40]
        perms = sorted(set(b.get("permissions") or []) & rbac.ALL)
        if len(name) < 2 or Role.objects.filter(name__iexact=name).exists():
            return err("choose a unique role name", 409)
        r = Role.objects.create(name=name, permissions=json.dumps(perms))
        audit(request, "role.create", None, name)
        return JsonResponse({"role": _role_json(r)}, status=201)
    return JsonResponse({"roles": [_role_json(r) for r in Role.objects.order_by("-builtin", "name")],
                         "permissions": [{"key": k, "label": v} for k, v in rbac.PERMS.items()]})


@api(("PATCH", "DELETE"), perm="roles.manage")
def role_detail(request, rid):
    r = Role.objects.filter(uid=str(rid)[:32]).first()
    if not r:
        return err("not found", 404)
    if r.builtin:
        return err("built-in roles are fixed", 403)
    if request.method == "DELETE":
        User.objects.filter(profile__role=r, is_superuser=False).update(is_staff=False)  # back to a plain user
        Profile.objects.filter(role=r).update(role=None)
        audit(request, "role.delete", None, r.name)
        r.delete()
        return JsonResponse({"ok": True})
    b = parse_json(request) or {}
    if "permissions" in b:
        r.permissions = json.dumps(sorted(set(b["permissions"] or []) & rbac.ALL))
    if b.get("name"):
        r.name = str(b["name"]).strip()[:40]
    r.save()
    audit(request, "role.update", None, r.name)
    return JsonResponse({"role": _role_json(r)})


# ---------- read-only data viewer (whitelisted columns; never password hashes, tokens, e-mail bodies) ----------
def _iso(d):
    return d.isoformat() if d else None


def _note_rows(kind):
    def f(r):
        enc = r.data.startswith('{"enc"')
        title = None
        if not enc:
            try:
                d = json.loads(r.data)
                title = d.get("title") or d.get("name")
            except ValueError:
                pass
        return {"owner": r.user.email, "id": r.record_id, "title": title if not enc else "(end-to-end encrypted)", "e2e": enc, "bytes": len(r.data), "deleted": r.deleted,
                "updated": r.updated_at, "parent": r.parent_id}
    return (lambda: Record.objects.filter(kind=kind).select_related("user").order_by("-id"), f, ["user__email", "record_id"])


TABLES = {
    "users": (lambda: User.objects.select_related("profile").order_by("-id"),
              lambda u: {"id": u.public_id, "email": u.email, "name": u.display_name, "role": rbac.role_of(u), "active": u.is_active, "joined": _iso(u.date_joined),
                         "lastLogin": _iso(u.last_login), "verified": getattr(getattr(u, "profile", None), "email_verified", None), "2fa": getattr(getattr(u, "profile", None), "totp_enabled", None)},
              ["email", "display_name"]),
    "notes": _note_rows("notes"), "notebooks": _note_rows("notebooks"),
    "shares": (lambda: Share.objects.select_related("owner", "recipient").order_by("-id"),
               lambda s: {"owner": s.owner.email, "recipient": s.recipient.email, "kind": s.kind, "record": s.record_id, "role": s.role, "viaLink": s.via_link, "expires": _iso(s.expires_at)},
               ["owner__email", "recipient__email"]),
    "devices": (lambda: Device.objects.select_related("user").order_by("-last_seen"),
                lambda d: {"user": d.user.email, "name": d.name, "browser": d.browser, "os": d.os, "kind": d.kind, "firstIp": d.first_ip, "lastIp": d.last_ip, "lastSeen": _iso(d.last_seen)},
                ["user__email", "name", "browser"]),
    "logins": (lambda: LoginEvent.objects.order_by("-id"),
               lambda e: {"at": _iso(e.created_at), "email": e.username, "event": e.event, "ok": e.ok, "ip": e.ip, "browser": e.browser, "os": e.os},
               ["username", "ip"]),
    "audit": (lambda: AuditLog.objects.select_related("user").order_by("-id"),
              lambda a: {"at": _iso(a.created_at), "event": a.event, "user": a.user.email if a.user else None, "actor": a.actor, "detail": a.detail, "ip": a.ip}, ["event", "detail", "actor"]),
    "mail": (lambda: MailQueue.objects.order_by("-id"),
             lambda m: {"at": _iso(m.created_at), "to": m.to, "kind": m.kind, "status": m.status, "note": m.note, "subject": m.subject}, ["to", "kind", "status"]),
    "links": (lambda: PublicLink.objects.select_related("owner").order_by("-id"),
              lambda l: {"owner": l.owner.email, "kind": l.kind, "note": l.note_id, "title": l.title, "visibility": l.visibility, "permission": l.permission, "views": l.views,
                         "edits": l.edits, "revoked": l.revoked, "password": bool(l.password_hash)}, ["owner__email", "title"]),
}


@api(("GET",), perm="data.read")
def data_tables(request):
    return JsonResponse({"tables": [{"name": n, "count": TABLES[n][0]().count()} for n in TABLES]})


@api(("GET",), perm="data.read")
def data_rows(request, table):
    spec = TABLES.get(table)
    if not spec:
        return err("not found", 404)
    qs_fn, row_fn, search = spec
    qs = qs_fn()
    q = request.GET.get("q", "").strip()[:80]
    if q:
        cond = Q()
        for f in search:
            cond |= Q(**{f + "__icontains": q})
        qs = qs.filter(cond)
    try:
        page = max(0, int(request.GET.get("page", 0)))
    except ValueError:
        page = 0
    total = qs.count()
    rows = [row_fn(x) for x in qs[page * PAGE:(page + 1) * PAGE]]
    audit(request, "data.view", None, table)
    return JsonResponse({"table": table, "total": total, "page": page, "pageSize": PAGE, "rows": rows})
