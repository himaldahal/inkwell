from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.http import JsonResponse

from . import quota
from .audit import audit
from .models import AuditLog, Device, Plan, Profile, Token
from .util import api, err, parse_json
from .views_auth import _check_password, purge_user_files, temp_password

User = get_user_model()


def _u(u):
    p = Profile.of(u)
    return {
        "id": u.public_id, "email": u.email, "displayName": u.display_name, "isActive": u.is_active, "isStaff": u.is_staff,
        "emailVerified": p.email_verified, "mustChangePassword": p.must_change_password,
        "lastLogin": u.last_login.isoformat() if u.last_login else None, "dateJoined": u.date_joined.isoformat(),
        "planId": p.plan_id, "plan": p.plan.name if p.plan else Plan.default().name,
        "storageMbOverride": p.storage_mb_override, "maxNotesOverride": p.max_notes_override,
        "quotaBytes": p.quota_bytes(), "noteLimit": p.note_limit(),
        "usage": {"assetBytes": quota.used_bytes(u), "notes": quota.note_count(u), "devices": Device.objects.filter(user=u).count()},
    }


@api(("GET", "POST"), staff=True)
def users(request):
    if request.method == "GET":
        qs = User.objects.order_by("email")
        q, f = request.GET.get("q"), request.GET.get("filter")
        if q:
            qs = qs.filter(Q(email__icontains=q) | Q(display_name__icontains=q))
        if f == "active":
            qs = qs.filter(is_active=True)
        elif f == "disabled":
            qs = qs.filter(is_active=False)
        elif f == "staff":
            qs = qs.filter(is_staff=True)
        elif f == "unverified":
            qs = qs.filter(profile__email_verified=False)
        return JsonResponse({"users": [_u(u) for u in qs[:500]],
                             "plans": list(Plan.objects.values("id", "name", "storage_mb", "max_notes", "is_default"))})
    b = parse_json(request) or {}
    email = str(b.get("email") or "").strip().lower()
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email

    try:
        validate_email(email)
    except ValidationError:
        return err("a valid e-mail address is required")
    if User.objects.filter(email=email).exists():
        return err("e-mail already registered", 409)
    pw = str(b.get("password") or "") or temp_password()
    msg = _check_password(pw, User(email=email))
    if msg:
        return err(msg)
    u = User.objects.create_user(email=email, password=pw, is_staff=bool(b.get("isStaff")), display_name=str(b.get("displayName") or "")[:60])
    Profile.objects.create(user=u, email_verified=True, must_change_password=True, plan_id=b.get("planId") or None,
                           storage_mb_override=b.get("storageMb"))
    from . import access

    access.claim_invites(u)
    audit(request, "admin.create_user", u, f"by {request.user.email}")
    return JsonResponse({"user": _u(u), "tempPassword": pw}, status=201)


@api(("PATCH", "POST", "DELETE"), staff=True)
def user_detail(request, uid):
    u = User.objects.filter(public_id=str(uid)[:32]).first()
    if not u:
        return err("not found", 404)
    if request.method == "DELETE":
        if u.pk == request.user.pk:
            return err("you cannot delete yourself")
        purge_user_files(u)
        audit(request, "admin.delete_user", None, u.email)
        u.delete()
        return JsonResponse({"ok": True})
    b = parse_json(request) or {}
    p = Profile.of(u)
    if "isActive" in b:
        if u.pk == request.user.pk and not b["isActive"]:
            return err("you cannot deactivate yourself")
        u.is_active = bool(b["isActive"])
        if not u.is_active:
            Token.objects.filter(user=u).delete()
    if "isStaff" in b:
        if u.pk == request.user.pk and not b["isStaff"]:
            return err("you cannot remove your own admin role")
        u.is_staff = bool(b["isStaff"])
    if "displayName" in b:
        u.display_name = str(b["displayName"] or "")[:60]
    if "email" in b:  # only staff can change an account's e-mail
        new = str(b["email"] or "").strip().lower()
        if User.objects.filter(email=new).exclude(pk=u.pk).exists():
            return err("e-mail already registered", 409)
        u.email = new
    u.save()
    if "storageMb" in b:
        p.storage_mb_override = None if b["storageMb"] in (None, "") else max(0, int(b["storageMb"]))
    if "maxNotes" in b:
        p.max_notes_override = None if b["maxNotes"] in (None, "") else max(0, int(b["maxNotes"]))
    if "planId" in b:
        p.plan_id = b["planId"] or None
    p.save()
    audit(request, "admin.update_user", u, ", ".join(sorted(b.keys())))
    return JsonResponse({"user": _u(u)})


@api(("POST",), staff=True)
def reset_password(request, uid):
    u = User.objects.filter(public_id=str(uid)[:32]).first()
    if not u:
        return err("not found", 404)
    pw = temp_password()
    u.set_password(pw)
    u.save()
    Profile.of(u)
    Profile.objects.filter(user=u).update(must_change_password=True)
    Token.objects.filter(user=u).delete()
    audit(request, "admin.reset_password", u)
    return JsonResponse({"tempPassword": pw, "user": _u(u)})


@api(("GET",), staff=True)
def audit_log(request):
    try:
        limit = min(500, int(request.GET.get("limit", 100)))
    except ValueError:
        limit = 100
    rows = AuditLog.objects.select_related("user")[:limit]
    return JsonResponse({"events": [
        {"id": r.pk, "at": r.created_at.isoformat(), "event": r.event, "user": r.user.email if r.user else None,
         "actor": r.actor, "detail": r.detail, "ip": r.ip} for r in rows]})


@api(("GET",), staff=True)
def stats(request):
    return JsonResponse({"users": User.objects.count(), "active": User.objects.filter(is_active=True).count(),
                         "storageBytes": sum(quota.used_bytes(u) for u in User.objects.all()),
                         "events": AuditLog.objects.aggregate(n=Count("id"))["n"]})


# ======================= dashboard extensions =======================
import csv  # noqa: E402
import os  # noqa: E402
from datetime import timedelta  # noqa: E402

from django.conf import settings  # noqa: E402
from django.core.mail import send_mail  # noqa: E402
from django.db import connection  # noqa: E402
from django.db.models import Count, Q  # noqa: E402
from django.db.models.functions import TruncDate  # noqa: E402
from django.http import HttpResponse  # noqa: E402
from django.utils import timezone  # noqa: E402

from . import runtime, trash  # noqa: E402
from .models import AbuseReport, Block, Lockout, LoginEvent, PublicLink, Record, Share  # noqa: E402
from .util import hit  # noqa: E402,F401


def _series(qs, field, days=30):
    since = timezone.now() - timedelta(days=days)
    rows = qs.filter(**{f"{field}__gte": since}).annotate(d=TruncDate(field)).values("d").annotate(n=Count("id"))
    by = {r["d"]: r["n"] for r in rows}
    today = timezone.now().date()
    return [{"date": str(today - timedelta(days=i)), "n": by.get(today - timedelta(days=i), 0)} for i in range(days - 1, -1, -1)]


@api(("GET",), staff=True)
def overview(request):
    now = timezone.now()
    return JsonResponse({
        "mode": settings.DEPLOYMENT_MODE,
        "totals": {
            "users": User.objects.count(), "active30d": User.objects.filter(last_login__gte=now - timedelta(days=30)).count(),
            "disabled": User.objects.filter(is_active=False).count(),
            "devices": Device.objects.count(), "activeDevices": Device.objects.filter(last_seen__gte=now - timedelta(days=7)).count(),
            "notes": Record.objects.filter(kind="notes", deleted=False).count(),
            "storageBytes": sum(quota.used_bytes(u) for u in User.objects.all()),
            "shares": Share.objects.count(), "links": PublicLink.objects.filter(revoked=False).count(),
            "linkViews": sum(PublicLink.objects.values_list("views", flat=True)),
        },
        "signups": _series(User.objects, "date_joined"),
        "logins": _series(LoginEvent.objects.filter(ok=True, event="login"), "created_at"),
        "failed": _series(LoginEvent.objects.filter(ok=False), "created_at"),
    })


@api(("GET",), staff=True)
def user_full(request, uid):
    u = User.objects.filter(public_id=str(uid)[:32]).first()
    if not u:
        return err("not found", 404)
    devs = [{"id": d.device_id, "name": d.name, "browser": d.browser, "os": d.os, "kind": d.kind, "firstIp": d.first_ip, "lastIp": d.last_ip,
             "firstSeen": d.created_at.isoformat(), "lastSeen": d.last_seen.isoformat(), "active": d.tokens.filter(expires_at__gt=timezone.now()).exists()}
            for d in Device.objects.filter(user=u).order_by("-last_seen")]
    hist = [{"at": e.created_at.isoformat(), "event": e.event, "ok": e.ok, "ip": e.ip, "browser": e.browser, "os": e.os, "kind": e.kind}
            for e in LoginEvent.objects.filter(Q(user=u) | Q(username__iexact=u.email))[:60]]
    shares = [{"id": s.uid, "kind": s.kind, "recordId": s.record_id, "role": s.role, "to": s.recipient.email} for s in Share.objects.filter(owner=u).select_related("recipient")[:100]]
    return JsonResponse({"user": _u(u), "devices": devs, "history": hist, "shares": shares})


@api(("POST",), staff=True)
def revoke_sessions(request, uid):
    u = User.objects.filter(public_id=str(uid)[:32]).first()
    if not u:
        return err("not found", 404)
    dev = request.GET.get("device")
    if dev:
        Device.objects.filter(user=u, device_id=dev).delete()
    else:
        Token.objects.filter(user=u).delete()
    audit(request, "admin.revoke_sessions", u, dev or "all")
    return JsonResponse({"ok": True})


@api(("POST",), staff=True)
def send_reset_email(request, uid):
    from . import emails
    from .models import EmailToken

    u = User.objects.filter(public_id=str(uid)[:32]).first()
    if not u or not u.email:
        return err("user has no e-mail address", 400)
    if not settings.SMTP_ENABLED:
        return err("e-mail is not configured on this server", 501)
    ok = emails.send_reset(request, u, EmailToken.issue(u, EmailToken.RESET))
    audit(request, "admin.send_reset", u)
    return JsonResponse({"ok": ok})


@api(("GET",), staff=True)
def shares_overview(request):
    shares = [{"id": s.uid, "owner": s.owner.email, "to": s.recipient.email, "kind": s.kind, "recordId": s.record_id,
               "role": s.role, "viaLink": s.via_link, "expiresAt": s.expires_at.isoformat() if s.expires_at else None}
              for s in Share.objects.select_related("owner", "recipient").order_by("-id")[:300]]
    links = [{"id": l.uid, "owner": l.owner.email, "kind": l.kind, "noteId": l.note_id, "title": l.title, "visibility": l.visibility,
              "permission": l.permission, "views": l.views, "edits": l.edits, "revoked": l.revoked, "hasPassword": bool(l.password_hash),
              "expiresAt": l.expires_at.isoformat() if l.expires_at else None, "path": f"/s/{l.token}", "updatedAt": l.updated_at.isoformat()}
             for l in PublicLink.objects.select_related("owner").order_by("-updated_at")[:300]]
    return JsonResponse({"shares": shares, "links": links})


@api(("POST", "DELETE"), staff=True)
def share_admin(request, share_id):
    s = Share.objects.filter(uid=share_id).first()
    if not s:
        return err("not found", 404)
    audit(request, "admin.share_delete", s.owner, f"{s.kind}:{s.record_id}")
    s.delete()
    return JsonResponse({"ok": True})


@api(("POST",), staff=True)
def link_admin(request, link_id):
    l = PublicLink.objects.filter(uid=link_id).first()
    if not l:
        return err("not found", 404)
    action = (parse_json(request) or {}).get("action")
    if action == "disable":
        l.revoked = True
    elif action == "enable":
        l.revoked = False
    elif action == "expire":
        l.expires_at = timezone.now()
    elif action == "delete":
        from .views_share import purge_link_files

        purge_link_files(l)
        audit(request, "admin.link_delete", l.owner, l.note_id)
        l.delete()
        return JsonResponse({"ok": True})
    else:
        return err("unknown action")
    l.save()
    audit(request, f"admin.link_{action}", l.owner, l.note_id)
    return JsonResponse({"ok": True})


@api(("GET", "POST"), staff=True)
def abuse(request):
    if request.method == "POST":
        b = parse_json(request) or {}
        kind, value = b.get("kind"), str(b.get("value") or "").strip().lower()
        if kind not in ("ip", "email", "domain") or not value:
            return err("invalid block")
        hours = b.get("hours")
        Block.objects.update_or_create(kind=kind, value=value[:190], defaults={
            "reason": str(b.get("reason") or "")[:200], "expires_at": timezone.now() + timedelta(hours=int(hours)) if hours else None})
        audit(request, "admin.block", None, f"{kind}:{value}")
        return JsonResponse({"ok": True})
    now = timezone.now()
    return JsonResponse({
        "blocks": [{"id": b.uid, "kind": b.kind, "value": b.value, "reason": b.reason, "createdAt": b.created_at.isoformat(),
                    "expiresAt": b.expires_at.isoformat() if b.expires_at else None} for b in Block.objects.order_by("-id")[:200]],
        "lockouts": [{"key": l.key, "fails": l.fails, "until": l.until.isoformat() if l.until else None}
                     for l in Lockout.objects.filter(until__gt=now).order_by("-until")[:100]],
        "failedLogins": [{"at": e.created_at.isoformat(), "username": e.username, "ip": e.ip, "event": e.event, "browser": e.browser}
                         for e in LoginEvent.objects.filter(ok=False)[:100]],
        "topFailingIps": list(LoginEvent.objects.filter(ok=False, created_at__gte=now - timedelta(days=1)).values("ip").annotate(n=Count("id")).order_by("-n")[:10]),
        "suppressedMail": [{"at": e.created_at.isoformat(), "detail": e.detail} for e in AuditLog.objects.filter(event="mail.suppressed")[:50]],
        "disposableDomains": sorted(runtime.DISPOSABLE),
        "reports": [{"id": r.uid, "kind": r.kind, "status": r.status, "reason": r.reason, "at": r.created_at.isoformat(),
                     "reporter": r.reporter.email if r.reporter else None, "target": r.target.email if r.target else None,
                     "targetId": r.target.public_id if r.target else None, "ref": r.ref}
                    for r in AbuseReport.objects.select_related("reporter", "target").order_by("-id")[:100]],
    })


@api(("DELETE", "POST"), staff=True)
def block_delete(request, block_id):
    if request.method == "POST":  # clear a lockout by key instead
        key = (parse_json(request) or {}).get("key", "")
        Lockout.objects.filter(key=key).delete()
        return JsonResponse({"ok": True})
    Block.objects.filter(uid=block_id).delete()
    audit(request, "admin.unblock", None, str(block_id))
    return JsonResponse({"ok": True})


SETTING_KEYS = ("registration_open", "allow_anonymous_links", "email_allow_domains", "email_deny_domains")


@api(("GET", "POST"), staff=True)
def runtime_settings(request):
    plan = Plan.default()
    if request.method == "POST":
        b = parse_json(request) or {}
        for k in SETTING_KEYS:
            if k in b:
                v = b[k]
                if k.endswith("_domains"):
                    v = sorted({str(x).strip().lower() for x in (v if isinstance(v, list) else str(v).replace(",", "\n").split()) if str(x).strip()})
                runtime.put(k, v)
        if "defaultStorageMb" in b:
            plan.storage_mb = max(0, int(b["defaultStorageMb"]))
        if "defaultMaxNotes" in b:
            plan.max_notes = max(0, int(b["defaultMaxNotes"]))
        plan.save()
        audit(request, "admin.settings", None, ", ".join(sorted(b.keys())))
    allow, deny = runtime.domain_lists()
    return JsonResponse({
        "mode": settings.DEPLOYMENT_MODE, "registration_open": runtime.registration_open(),
        "allow_anonymous_links": runtime.anonymous_links_allowed(), "email_allow_domains": allow, "email_deny_domains": deny,
        "defaultStorageMb": plan.storage_mb, "defaultMaxNotes": plan.max_notes, "trashRetentionDays": settings.TRASH_RETENTION_DAYS,
    })


@api(("GET",), staff=True)
def audit_view(request):
    qs = AuditLog.objects.select_related("user")
    ev, q = request.GET.get("event"), request.GET.get("q")
    if ev:
        qs = qs.filter(event__startswith=ev)
    if q:
        qs = qs.filter(Q(actor__icontains=q) | Q(detail__icontains=q) | Q(ip__icontains=q) | Q(user__email__icontains=q))
    if request.GET.get("since"):
        try:
            qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=int(request.GET["since"])))
        except ValueError:
            pass
    try:
        limit = min(5000, int(request.GET.get("limit", 200)))
    except ValueError:
        limit = 200
    rows = list(qs[:limit])
    if request.GET.get("format") == "csv":
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="inkwell-audit.csv"'
        w = csv.writer(resp)
        w.writerow(["time", "event", "user", "actor", "detail", "ip"])
        for r in rows:  # guard against spreadsheet formula injection
            safe = lambda v: ("'" + v) if v[:1] in "=+-@" else v  # noqa: E731
            w.writerow([r.created_at.isoformat(), r.event, safe(r.user.email if r.user else ""), safe(r.actor), safe(r.detail), r.ip])
        return resp
    return JsonResponse({"events": [{"id": r.pk, "at": r.created_at.isoformat(), "event": r.event, "user": r.user.email if r.user else None,
                                      "actor": r.actor, "detail": r.detail, "ip": r.ip} for r in rows]})


def _dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


@api(("GET",), staff=True)
def health(request):
    db = settings.DATABASES["default"]
    db_size = None
    if db["ENGINE"].endswith("sqlite3"):
        try:
            db_size = os.path.getsize(db["NAME"])
        except OSError:
            pass
    else:
        try:
            with connection.cursor() as c:
                c.execute("SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema=%s", [db["NAME"]])
                db_size = int(c.fetchone()[0])
        except Exception:  # noqa: BLE001
            pass
    return JsonResponse({
        "ok": True, "mode": settings.DEPLOYMENT_MODE, "debug": settings.DEBUG, "db": db["ENGINE"].rsplit(".", 1)[-1], "dbBytes": db_size,
        "mediaBytes": _dir_size(settings.MEDIA_ROOT), "emailBackend": "smtp" if settings.SMTP_ENABLED else "console (not delivered)",
        "emailFrom": settings.DEFAULT_FROM_EMAIL, "smtpHost": settings.EMAIL_HOST or None, "verification": settings.REQUIRE_EMAIL_VERIFICATION,
        "longPoll": settings.LONGPOLL, "turn": bool(settings.TURN_URL), "trustedProxies": settings.TRUSTED_PROXIES,
        "https": request.is_secure(), "time": now_ms(),
    })


@api(("POST",), staff=True)
def test_email(request):
    to = str((parse_json(request) or {}).get("to") or request.user.email or "").strip()
    if not to:
        return err("no recipient")
    if not hit(f"testmail:{request.user.pk}", 5, 3600):
        return err("too many test e-mails", 429)
    try:
        send_mail("Inkwell test e-mail", "If you can read this, outgoing e-mail works.", settings.DEFAULT_FROM_EMAIL, [to], fail_silently=False)
    except Exception as e:  # noqa: BLE001
        return err(f"sending failed: {e}", 502)
    audit(request, "admin.test_email", None, to)
    return JsonResponse({"ok": True, "backend": "smtp" if settings.SMTP_ENABLED else "console"})


@api(("GET", "POST"), staff=True)
def trash_admin(request):
    if request.method == "POST":
        b = parse_json(request) or {}
        if b.get("userId"):
            n = trash.purge_qs(Record.objects.filter(user__public_id=str(b["userId"])[:32], deleted=True))
        elif b.get("all"):
            n = trash.purge_expired(0 if b.get("now") else None)
        else:
            return err("userId or all required")
        audit(request, "admin.trash_purge", None, f"{n} records")
        return JsonResponse({"ok": True, "purged": n})
    rows = (Record.objects.filter(deleted=True).exclude(data="{}").values("user__email", "user__public_id").annotate(n=Count("id")).order_by("-n")[:100])
    return JsonResponse({"retentionDays": settings.TRASH_RETENTION_DAYS, "users": list(rows)})


@api(("POST",), staff=True)
def report_resolve(request, rid):
    r = AbuseReport.objects.filter(uid=rid).first()
    if not r:
        return err("not found", 404)
    r.status = "closed"
    r.save()
    audit(request, "admin.report_closed", r.target, r.kind)
    return JsonResponse({"ok": True})


# ---- mail abuse panel ----
@api(("GET", "POST"), staff=True)
def mail_panel(request):
    from . import emails
    from .models import MailQueue, SuppressedAddress

    if request.method == "POST":
        b = parse_json(request) or {}
        if b.get("flush"):
            return JsonResponse({"sent": emails.flush_queue(20)})
        email = str(b.get("email") or "").strip().lower()
        if "@" not in email:
            return err("invalid address")
        SuppressedAddress.objects.get_or_create(email=email, defaults={"reason": b.get("reason") if b.get("reason") in ("bounce", "complaint") else "manual"})
        audit(request, "admin.suppress", None, email)
        return JsonResponse({"ok": True})
    day = timezone.now() - timedelta(days=1)
    recent = MailQueue.objects.filter(created_at__gte=day)
    return JsonResponse({
        "counts": {r["status"]: r["n"] for r in MailQueue.objects.values("status").annotate(n=Count("id"))},
        "recent": [{"at": m.created_at.isoformat(), "to": m.to, "kind": m.kind, "status": m.status, "note": m.note, "ip": m.ip} for m in MailQueue.objects.order_by("-id")[:100]],
        "topRecipients": list(recent.values("to").annotate(n=Count("id")).order_by("-n")[:10]),
        "topIps": list(recent.exclude(ip="").values("ip").annotate(n=Count("id")).order_by("-n")[:10]),
        "suppressed": [{"id": s.uid, "email": s.email, "reason": s.reason, "at": s.created_at.isoformat()} for s in SuppressedAddress.objects.order_by("-id")[:200]],
        "alerts": [{"at": a.created_at.isoformat(), "detail": a.detail} for a in AuditLog.objects.filter(event="mail.alert").order_by("-id")[:20]],
        "caps": {"recipientHour": settings.MAIL_PER_RECIPIENT_HOURLY, "recipientDay": settings.MAIL_PER_RECIPIENT_DAILY, "ipHour": settings.MAIL_PER_IP_HOURLY,
                 "accountHour": settings.MAIL_PER_ACCOUNT_HOURLY, "globalHour": settings.MAIL_GLOBAL_HOURLY, "perMinute": settings.MAIL_PER_MINUTE},
    })


@api(("DELETE",), staff=True)
def suppress_delete(request, sid):
    from .models import SuppressedAddress

    SuppressedAddress.objects.filter(uid=sid).delete()
    audit(request, "admin.unsuppress", None, sid)
    return JsonResponse({"ok": True})
