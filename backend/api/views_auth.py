import secrets
import shutil

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone

from . import emails, quota
from .audit import audit
from .models import AssetBlob, Device, EmailToken, Profile, Record, Token, now_ms
from .util import api, client_ip, err, hit, parse_json

User = get_user_model()


def registration_open():
    return bool(settings.ALLOW_REGISTRATION)


@api(("GET",), auth=False)
def config(request):
    return JsonResponse({
        "mode": settings.DEPLOYMENT_MODE,
        "registrationOpen": registration_open(),
        "smtp": settings.SMTP_ENABLED,
        "emailVerification": settings.REQUIRE_EMAIL_VERIFICATION,
        "passwordReset": settings.SMTP_ENABLED,
        "features": {"sharing": True, "publicLinks": True, "e2e": True, "admin": True},
        "limits": {"assetMaxBytes": settings.ASSET_MAX_BYTES},
        "serverTime": now_ms(),
    })


def _device_for(request, user, body):
    did = str(body.get("deviceId") or "")[:64]
    if not did:
        return None
    name = str(body.get("deviceName") or "")[:120]
    dev, _ = Device.objects.get_or_create(user=user, device_id=did)
    if name:
        dev.name = name
    dev.user_agent = request.headers.get("User-Agent", "")[:250]
    dev.last_seen = timezone.now()
    dev.save()
    Token.objects.filter(device=dev).delete()  # one live token per device
    return dev


def user_json(u):
    p = Profile.of(u)
    return {"id": u.pk, "username": u.get_username(), "email": u.email, "isStaff": u.is_staff,
            "emailVerified": p.email_verified, "mustChangePassword": p.must_change_password}


def _session(request, user, body):
    dev = _device_for(request, user, body)
    key, _ = Token.issue(user, dev)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    return JsonResponse({"token": key, "user": user_json(user), "mustChangePassword": Profile.of(user).must_change_password, "serverTime": now_ms()})


def _check_password(pw, user=None):
    try:
        validate_password(pw, user)
    except ValidationError as e:
        return " ".join(e.messages)
    return None


@api(("POST",), auth=False)
def register(request):
    if not registration_open():
        return err("registration is disabled", 403)
    if not hit(f"reg:{client_ip(request)}", settings.RATE_LIMIT_AUTH, 60):
        return err("too many attempts, try again later", 429)
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    username = str(b.get("username") or "").strip()
    password = str(b.get("password") or "")
    email = str(b.get("email") or "").strip().lower()[:254]
    if not (3 <= len(username) <= 60) or any(c.isspace() for c in username):
        return err("username must be 3-60 characters without spaces")
    commercial = settings.DEPLOYMENT_MODE == "commercial"
    if commercial or email:
        try:
            validate_email(email)
        except ValidationError:
            return err("a valid e-mail address is required")
    if User.objects.filter(username__iexact=username).exists():
        return err("username already taken", 409)
    if email and User.objects.filter(email__iexact=email).exists():
        return err("e-mail already registered", 409)
    msg = _check_password(password, User(username=username, email=email))
    if msg:
        return err(msg)
    user = User.objects.create_user(username=username, email=email, password=password)
    needs_verify = settings.REQUIRE_EMAIL_VERIFICATION
    Profile.objects.create(user=user, email_verified=not needs_verify)
    audit(request, "register", user)
    if needs_verify:
        emails.send_verify(request, user, EmailToken.issue(user, EmailToken.VERIFY))
        return JsonResponse({"verificationRequired": True, "email": email})
    if settings.SMTP_ENABLED and email:
        emails.send_welcome(request, user)
    return _session(request, user, b)


@api(("POST",), auth=False)
def login(request):
    ip = client_ip(request)
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    username = str(b.get("username") or "").strip()
    if not hit(f"login:{ip}:{username.lower()}", settings.RATE_LIMIT_LOGIN, 300) or not hit(
        f"loginip:{ip}", settings.RATE_LIMIT_AUTH * 3, 60
    ):
        return err("too many attempts, try again later", 429)
    user = User.objects.filter(username__iexact=username).first()
    if user is None and "@" in username:
        user = User.objects.filter(email__iexact=username).first()
    pw = str(b.get("password") or "")
    ok = user.check_password(pw) if user else (User().set_password(pw) or False)  # constant-ish time
    if not ok or not user.is_active:
        audit(request, "login_failed", user, username[:60])
        return err("invalid username or password", 401)
    if settings.REQUIRE_EMAIL_VERIFICATION and not Profile.of(user).email_verified:
        return err("please confirm your e-mail address first", 403, code="unverified")
    audit(request, "login", user)
    return _session(request, user, b)


@api(("POST",), pw_ok=True)
def logout(request):
    request.token.delete()
    return JsonResponse({"ok": True})


@api(("POST",))
def refresh(request):
    """Rotate the bearer token (old one is invalidated)."""
    t = request.token
    key, _ = Token.issue(request.user, t.device)
    t.delete()
    return JsonResponse({"token": key, "serverTime": now_ms()})


@api(("GET",), pw_ok=True)
def me(request):
    u = request.user
    p = Profile.of(u)
    return JsonResponse({
        "user": user_json(u),
        "mode": settings.DEPLOYMENT_MODE,
        "plan": (p.plan or None) and p.plan.name,
        "usage": {
            "assetBytes": quota.used_bytes(u),
            "assets": AssetBlob.objects.filter(user=u).count(),
            "records": Record.objects.filter(user=u, deleted=False).count(),
            "notes": quota.note_count(u),
            "quotaBytes": p.quota_bytes(),
            "noteLimit": p.note_limit(),
        },
        "tokenExpires": request.token.expires_at.isoformat(),
        "tokenCreated": request.token.created_at.isoformat(),
        "serverTime": now_ms(),
    })


@api(("POST",), pw_ok=True)
def change_password(request):
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    u = request.user
    if not u.check_password(str(b.get("oldPassword") or "")):
        return err("current password is incorrect", 403)
    new = str(b.get("newPassword") or "")
    if new == str(b.get("oldPassword") or ""):
        return err("choose a different password")
    msg = _check_password(new, u)
    if msg:
        return err(msg)
    u.set_password(new)
    u.save()
    Profile.objects.filter(user=u).update(must_change_password=False)
    Token.objects.filter(user=u).exclude(pk=request.token.pk).delete()  # sign out other devices
    audit(request, "password_changed", u)
    return JsonResponse({"ok": True})


def purge_user_files(user):
    shutil.rmtree(settings.MEDIA_ROOT / "assets" / str(user.pk), ignore_errors=True)
    for link in user.public_links.all():
        shutil.rmtree(settings.MEDIA_ROOT / "public" / str(link.pk), ignore_errors=True)


@api(("POST", "DELETE"))
def delete_account(request):
    b = parse_json(request) or {}
    u = request.user
    if not u.check_password(str(b.get("password") or "")):
        return err("password is incorrect", 403)
    audit(request, "account_deleted", None, u.get_username())
    with transaction.atomic():
        purge_user_files(u)
        u.delete()
    return JsonResponse({"ok": True})


@api(("GET",))
def export_data(request):
    """Everything the account owns as JSON (records only; asset blobs are fetched via /api/assets)."""
    import json

    recs = [{"kind": r.kind, "id": r.record_id, "updatedAt": r.updated_at, "deleted": r.deleted, "data": json.loads(r.data or "{}")}
            for r in Record.objects.filter(user=request.user).order_by("seq")]
    assets = list(AssetBlob.objects.filter(user=request.user).values("asset_id", "size", "mime"))
    resp = JsonResponse({"format": "inkwell-account-export", "user": user_json(request.user), "exportedAt": now_ms(), "records": recs, "assets": assets})
    resp["Content-Disposition"] = 'attachment; filename="inkwell-export.json"'
    audit(request, "export", request.user)
    return resp


# ---- e-mail flows ----
@api(("POST",), auth=False)
def verify(request):
    b = parse_json(request) or {}
    raw = str(b.get("token") or "")
    t = EmailToken.consume(raw, EmailToken.VERIFY)
    if t:
        Profile.of(t.user)
        Profile.objects.filter(user=t.user).update(email_verified=True)
        audit(request, "email_verified", t.user)
        if settings.SMTP_ENABLED:
            emails.send_welcome(request, t.user)
        return JsonResponse({"ok": True, "verified": True})
    t = EmailToken.consume(raw, EmailToken.CHANGE)
    if t:
        if User.objects.filter(email__iexact=t.new_email).exclude(pk=t.user_id).exists():
            return err("e-mail already registered", 409)
        t.user.email = t.new_email
        t.user.save(update_fields=["email"])
        Profile.objects.filter(user=t.user).update(email_verified=True)
        audit(request, "email_changed", t.user)
        return JsonResponse({"ok": True, "verified": True})
    return err("this link is invalid or has expired", 400)


@api(("POST",), auth=False)
def resend(request):
    b = parse_json(request) or {}
    email = str(b.get("email") or "").strip().lower()
    if not hit(f"resendip:{client_ip(request)}", 10, 3600):
        return err("too many attempts, try again later", 429)
    from django.core.cache import cache

    if email and cache.add(f"resend:{email}", 1, settings.EMAIL_RESEND_SECONDS):
        u = User.objects.filter(email__iexact=email, is_active=True).first()
        if u and not Profile.of(u).email_verified and settings.SMTP_ENABLED:
            emails.send_verify(request, u, EmailToken.issue(u, EmailToken.VERIFY))
    return JsonResponse({"ok": True})  # same answer whether or not the address exists


@api(("POST",), auth=False)
def forgot(request):
    if not settings.SMTP_ENABLED:
        return err("Password reset by e-mail is not available on this server. Ask an administrator to reset it.", 501)
    b = parse_json(request) or {}
    email = str(b.get("email") or "").strip().lower()
    if not hit(f"forgotip:{client_ip(request)}", 10, 3600):
        return err("too many attempts, try again later", 429)
    from django.core.cache import cache

    if email and cache.add(f"forgot:{email}", 1, settings.EMAIL_RESEND_SECONDS):
        u = User.objects.filter(email__iexact=email, is_active=True).first()
        if u:
            emails.send_reset(request, u, EmailToken.issue(u, EmailToken.RESET))
            audit(request, "password_reset_requested", u)
    return JsonResponse({"ok": True})


@api(("POST",), auth=False)
def reset(request):
    b = parse_json(request) or {}
    if not hit(f"resetip:{client_ip(request)}", 20, 3600):
        return err("too many attempts, try again later", 429)
    new = str(b.get("newPassword") or "")
    # validate before consuming so a weak password does not burn the link
    from .models import hash_key

    pre = EmailToken.objects.select_related("user").filter(token_hash=hash_key(str(b.get("token") or "")), purpose=EmailToken.RESET, used=False).first()
    if not pre or pre.expires_at <= timezone.now():
        return err("this link is invalid or has expired", 400)
    msg = _check_password(new, pre.user)
    if msg:
        return err(msg)
    t = EmailToken.consume(str(b.get("token")), EmailToken.RESET)
    if not t:
        return err("this link is invalid or has expired", 400)
    t.user.set_password(new)
    t.user.save()
    Profile.of(t.user)
    Profile.objects.filter(user=t.user).update(must_change_password=False, email_verified=True)
    Token.objects.filter(user=t.user).delete()
    audit(request, "password_reset", t.user)
    return JsonResponse({"ok": True})


@api(("POST",))
def change_email(request):
    b = parse_json(request) or {}
    u = request.user
    if not u.check_password(str(b.get("password") or "")):
        return err("password is incorrect", 403)
    new = str(b.get("newEmail") or "").strip().lower()
    try:
        validate_email(new)
    except ValidationError:
        return err("a valid e-mail address is required")
    if User.objects.filter(email__iexact=new).exclude(pk=u.pk).exists():
        return err("e-mail already registered", 409)
    if settings.SMTP_ENABLED:
        if not hit(f"chmail:{u.pk}", 5, 3600):
            return err("too many attempts, try again later", 429)
        emails.send_verify(request, u, EmailToken.issue(u, EmailToken.CHANGE, new_email=new), new_email=new)
        return JsonResponse({"ok": True, "pending": True})
    u.email = new
    u.save(update_fields=["email"])
    audit(request, "email_changed", u)
    return JsonResponse({"ok": True, "pending": False})


@api(("GET",))
def devices(request):
    cur = request.token.device_id
    out = [
        {
            "id": d.device_id, "name": d.name, "userAgent": d.user_agent,
            "createdAt": d.created_at.isoformat(), "lastSeen": d.last_seen.isoformat(),
            "current": d.pk == cur, "active": d.tokens.filter(expires_at__gt=timezone.now()).exists(),
        }
        for d in Device.objects.filter(user=request.user).order_by("-last_seen")
    ]
    return JsonResponse({"devices": out})


@api(("DELETE", "POST"))
def device_detail(request, device_id):
    """Revoke a device: removes its tokens and the device row."""
    n, _ = Device.objects.filter(user=request.user, device_id=device_id).delete()
    if not n:
        return err("not found", 404)
    return JsonResponse({"ok": True, "revoked": device_id})


def temp_password():
    return secrets.token_urlsafe(9) + "-" + str(secrets.randbelow(90) + 10)
