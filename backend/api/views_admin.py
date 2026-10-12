from django.contrib.auth import get_user_model
from django.db.models import Count
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
        "id": u.pk, "username": u.get_username(), "email": u.email, "isActive": u.is_active, "isStaff": u.is_staff,
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
        return JsonResponse({"users": [_u(u) for u in User.objects.order_by("username")],
                             "plans": list(Plan.objects.values("id", "name", "storage_mb", "max_notes", "is_default"))})
    b = parse_json(request) or {}
    username = str(b.get("username") or "").strip()
    email = str(b.get("email") or "").strip().lower()
    if not (3 <= len(username) <= 60) or any(c.isspace() for c in username):
        return err("username must be 3-60 characters without spaces")
    if User.objects.filter(username__iexact=username).exists():
        return err("username already taken", 409)
    if email and User.objects.filter(email__iexact=email).exists():
        return err("e-mail already registered", 409)
    pw = str(b.get("password") or "") or temp_password()
    msg = _check_password(pw, User(username=username, email=email))
    if msg:
        return err(msg)
    u = User.objects.create_user(username=username, email=email, password=pw, is_staff=bool(b.get("isStaff")))
    Profile.objects.create(user=u, email_verified=True, must_change_password=True, plan_id=b.get("planId") or None,
                           storage_mb_override=b.get("storageMb"))
    audit(request, "admin.create_user", u, f"by {request.user.get_username()}")
    return JsonResponse({"user": _u(u), "tempPassword": pw}, status=201)


@api(("PATCH", "POST", "DELETE"), staff=True)
def user_detail(request, uid):
    u = User.objects.filter(pk=uid).first()
    if not u:
        return err("not found", 404)
    if request.method == "DELETE":
        if u.pk == request.user.pk:
            return err("you cannot delete yourself")
        purge_user_files(u)
        audit(request, "admin.delete_user", None, u.get_username())
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
    if "email" in b:
        u.email = str(b["email"] or "").strip().lower()
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
    u = User.objects.filter(pk=uid).first()
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
        {"id": r.pk, "at": r.created_at.isoformat(), "event": r.event, "user": r.user.get_username() if r.user else None,
         "actor": r.actor, "detail": r.detail, "ip": r.ip} for r in rows]})


@api(("GET",), staff=True)
def stats(request):
    return JsonResponse({"users": User.objects.count(), "active": User.objects.filter(is_active=True).count(),
                         "storageBytes": sum(quota.used_bytes(u) for u in User.objects.all()),
                         "events": AuditLog.objects.aggregate(n=Count("id"))["n"]})
