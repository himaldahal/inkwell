import os
import secrets
import shutil

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import FileResponse, JsonResponse
from django.utils import timezone

from . import access, emails, rbac, pow as powmod, quota, runtime, security, totp, validate
from .audit import audit
from .models import AssetBlob, Cooldown, Device, EmailToken, Profile, Record, Token, hash_key, new_uid, now_ms
from .useragent import parse_ua
from .util import api, client_ip, err, hit, parse_json, public_user

User = get_user_model()


def registration_open():
    return runtime.registration_open()


@api(("GET",), auth=False)
def config(request):
    return JsonResponse({
        "mode": settings.DEPLOYMENT_MODE, "registrationOpen": registration_open(), "smtp": settings.SMTP_ENABLED,
        "emailVerification": settings.REQUIRE_EMAIL_VERIFICATION, "passwordReset": settings.SMTP_ENABLED,
        "features": {"sharing": True, "publicLinks": True, "e2e": True, "admin": True, "presence": True, "longPoll": settings.LONGPOLL,
                     "p2p": bool(settings.TURN_URL), "anonymousLinks": runtime.anonymous_links_allowed()},
        "limits": {"assetMaxBytes": settings.ASSET_MAX_BYTES}, "serverTime": now_ms(),
    })


def _device_for(request, user, body):
    did = str(body.get("deviceId") or "")[:64]
    if not did or not validate.ID_RE.match(did):
        return None, False
    dev, created = Device.objects.get_or_create(user=user, device_id=did)
    dev.name = str(body.get("deviceName") or dev.name)[:120]
    ua = request.headers.get("User-Agent", "")[:250]
    dev.user_agent = ua
    dev.browser, dev.os, dev.kind = parse_ua(ua)
    ip = client_ip(request)
    dev.last_ip = ip
    dev.first_ip = dev.first_ip or ip
    dev.last_seen = timezone.now()
    dev.save()
    Token.objects.filter(device=dev).delete()  # one live token per device
    return dev, created


def user_json(u):
    p = Profile.of(u)
    return {"id": u.public_id, "email": u.email, "displayName": u.display_name, "name": u.display, "avatar": p.avatar_id or None,
            "isStaff": u.is_staff, "role": rbac.role_of(u), "permissions": sorted(rbac.perms_of(u)), "twoFactor": p.totp_enabled, "emailVerified": p.email_verified, "mustChangePassword": p.must_change_password}


def _session(request, user, body, event="login"):
    dev, new_device = _device_for(request, user, body)
    key, _ = Token.issue(user, dev)
    security.record_event(request, user, user.email, event)
    if (new_device and event == "login" and settings.DEPLOYMENT_MODE == "commercial" and settings.SMTP_ENABLED
            and Device.objects.filter(user=user).count() > 1):
        emails.send_new_device(request, user, dev)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    return JsonResponse({"token": key, "user": user_json(user), "mustChangePassword": Profile.of(user).must_change_password, "serverTime": now_ms()})


def _check_password(pw, user=None):
    try:
        validate_password(pw, user)
    except ValidationError as e:
        return " ".join(e.messages)
    return None


def _norm_email(v):
    return str(v or "").strip().lower()[:254]


@api(("POST",), auth=False)
def register(request):
    if not registration_open():
        return err("registration is disabled", 403)
    ip = client_ip(request)
    if security.is_blocked(request) or not hit(f"reg:{ip}", settings.RATE_LIMIT_AUTH, 60) or not hit(f"reg-h:{ip}", 30, 3600):
        return err("too many attempts, try again later", 429)
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    # bot traps (honeypot + implausibly fast submit) get a fake success
    if str(b.get("website") or "").strip() or (b.get("elapsedMs") is not None and int(b.get("elapsedMs") or 0) < 1200):
        security.record_event(request, None, _norm_email(b.get("email")), "blocked", False)
        return JsonResponse({"verificationRequired": True})
    if not powmod.verify(request, "register", b.get("pow")):
        return err("please retry (proof of work failed)", 400, code="pow-required")
    email, password = _norm_email(b.get("email")), str(b.get("password") or "")
    name = validate.plain(b.get("displayName") or "", 60)
    try:
        validate_email(email)
    except ValidationError:
        return err("a valid e-mail address is required")
    bad = security.email_policy_error(email)
    if bad or security.is_blocked(request, email):
        return err(bad or "this e-mail address cannot be used")
    msg = _check_password(password, User(email=email))
    if msg:
        return err(msg)
    needs_verify = settings.REQUIRE_EMAIL_VERIFICATION
    existing = User.objects.filter(email=email).first()
    if existing:
        if needs_verify:  # same answer as a fresh sign-up: no account enumeration
            emails.send_already_registered(request, existing)
            return JsonResponse({"verificationRequired": True, "email": email})
        return err("could not create the account with these details", 409)
    user = User.objects.create_user(email=email, password=password, display_name=name)
    Profile.objects.create(user=user, email_verified=not needs_verify)
    audit(request, "register", user)
    if needs_verify:
        security.record_event(request, user, email, "register")
        emails.send_verify(request, user, EmailToken.issue(user, EmailToken.VERIFY))
        return JsonResponse({"verificationRequired": True, "email": email})
    access.claim_invites(user)
    if settings.SMTP_ENABLED:
        emails.send_welcome(request, user)
    return _session(request, user, b, "register")


@api(("POST",), auth=False)
def login(request):
    ip = client_ip(request)
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    email = _norm_email(b.get("email") or b.get("username"))
    lkey = f"{ip}|{email}"
    if security.is_blocked(request):
        return err("too many attempts, try again later", 429)
    wait = security.lockout_remaining(lkey)
    if wait:
        r = err(f"too many failed attempts, try again in {wait}s", 429)
        r["Retry-After"] = str(wait)
        return r
    if not hit(f"login:{lkey}", settings.RATE_LIMIT_LOGIN, 300) or not hit(f"loginip:{ip}", settings.RATE_LIMIT_AUTH * 3, 60):
        return err("too many attempts, try again later", 429)
    user = User.objects.filter(email=email).first()
    pw = str(b.get("password") or "")
    ok = user.check_password(pw) if user else (User().set_password(pw) or False)  # hasher always runs
    if not ok or not user.is_active:
        audit(request, "login_failed", user, email[:60])
        security.record_event(request, user, email, "failed", False)
        security.register_failure(lkey, settings.LOCKOUT_AFTER)
        return err("invalid e-mail or password", 401)
    if settings.REQUIRE_EMAIL_VERIFICATION and not Profile.of(user).email_verified:
        return err("please confirm your e-mail address first", 403, code="unverified")
    prof = Profile.of(user)
    if prof.totp_enabled:
        dev = Device.objects.filter(user=user, device_id=str(b.get("deviceId") or "")).first()
        trusted = dev and dev.trusted_until and dev.trusted_until > timezone.now()
        if not trusted:
            code = str(b.get("code") or "")
            if not code:
                return err("two-factor code required", 401, code="2fa-required")
            step = totp.verify(prof.totp_secret, code, prof.totp_last_step)
            if step:
                prof.totp_last_step = step
                prof.save(update_fields=["totp_last_step"])
            else:
                import json as _j

                left = totp.use_recovery(_j.loads(prof.recovery_hashes or "[]"), code)
                if left is None:
                    security.register_failure(lkey, settings.LOCKOUT_AFTER)
                    security.record_event(request, user, email, "failed", False)
                    return err("invalid code", 401, code="2fa-required")
                prof.recovery_hashes = _j.dumps(left)
                prof.save(update_fields=["recovery_hashes"])
    security.clear_failures(lkey)
    audit(request, "login", user)
    resp = _session(request, user, b)
    if prof.totp_enabled and b.get("remember"):
        Device.objects.filter(user=user, device_id=str(b.get("deviceId") or "")).update(trusted_until=timezone.now() + __import__('datetime').timedelta(days=30))
    return resp


@api(("POST",), pw_ok=True)
def logout(request):
    request.token.delete()
    return JsonResponse({"ok": True})


@api(("POST",))
def refresh(request):
    t = request.token
    key, _ = Token.issue(request.user, t.device)
    t.delete()
    return JsonResponse({"token": key, "serverTime": now_ms()})


@api(("GET", "PATCH"), pw_ok=True)
def me(request):
    u = request.user
    p = Profile.of(u)
    if request.method == "PATCH":  # profile: display name only (e-mail is staff-managed, avatar has its own endpoint)
        b = parse_json(request) or {}
        if not hit(f"profile:{u.pk}", 20, 3600):
            return err("too many changes, try again later", 429)
        if "displayName" in b:
            u.display_name = validate.plain(b.get("displayName") or "", 60)
            u.save(update_fields=["display_name"])
            audit(request, "profile_updated", u)
        if b.get("removeAvatar") and p.avatar_id:
            _rm_avatar(p)
    return JsonResponse({
        "user": user_json(u), "mode": settings.DEPLOYMENT_MODE, "plan": p.plan.name if p.plan else None,
        "usage": {"assetBytes": quota.used_bytes(u), "assets": AssetBlob.objects.filter(user=u).count(),
                  "records": Record.objects.filter(user=u, deleted=False).count(), "notes": quota.note_count(u),
                  "quotaBytes": p.quota_bytes(), "noteLimit": p.note_limit()},
        "tokenExpires": request.token.expires_at.isoformat(), "tokenCreated": request.token.created_at.isoformat(), "serverTime": now_ms(),
    })


def _avatar_path(aid):
    return settings.MEDIA_ROOT / "avatars" / aid


def _rm_avatar(p):
    try:
        os.remove(_avatar_path(p.avatar_id))
    except OSError:
        pass
    p.avatar_id = ""
    p.save(update_fields=["avatar_id"])


@api(("PUT",), pw_ok=True)
def avatar_upload(request):
    """Client re-encodes to a 256px png/jpeg/webp (<=200KB); the server re-checks size and magic bytes."""
    cl = request.META.get("CONTENT_LENGTH") or ""
    if not cl.isdigit() or int(cl) > 200_000:
        return err("avatar must be 200 KB or smaller", 413)
    data = request.read(200_001)
    kind = validate.sniff(data[:16])
    if kind not in ("image/png", "image/jpeg", "image/webp") or len(data) > 200_000:
        return err("avatar must be a PNG, JPEG or WebP image", 415)
    if not hit(f"avatar:{request.user.pk}", 10, 3600):
        return err("too many changes, try again later", 429)
    p = Profile.of(request.user)
    if p.avatar_id:
        _rm_avatar(p)
    p.avatar_id = new_uid()
    (settings.MEDIA_ROOT / "avatars").mkdir(parents=True, exist_ok=True)
    _avatar_path(p.avatar_id).write_bytes(data)
    p.save(update_fields=["avatar_id"])
    return JsonResponse({"avatar": p.avatar_id})


@api(("GET",))
def avatar_get(request, avatar_id):
    """Only the owner, their collaborators and staff can fetch an avatar (ids are random)."""
    p = Profile.objects.filter(avatar_id=avatar_id).select_related("user").first()
    f = _avatar_path(avatar_id) if validate.ID_RE.match(avatar_id) else None
    if not p or not f or not f.is_file() or not access.related(request.user, p.user):
        return err("not found", 404)
    head = f.read_bytes()[:16]
    r = FileResponse(open(f, "rb"), content_type=validate.sniff(head) or "image/png")
    r["Cache-Control"] = "private, max-age=86400"
    return r


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
    Token.objects.filter(user=u).exclude(pk=request.token.pk).delete()
    audit(request, "password_changed", u)
    return JsonResponse({"ok": True})


def purge_user_files(user):
    shutil.rmtree(settings.MEDIA_ROOT / "assets" / str(user.pk), ignore_errors=True)
    for link in user.public_links.all():
        shutil.rmtree(settings.MEDIA_ROOT / "public" / str(link.pk), ignore_errors=True)
    p = Profile.objects.filter(user=user).first()
    if p and p.avatar_id:
        _rm_avatar(p)


@api(("POST", "DELETE"))
def delete_account(request):
    b = parse_json(request) or {}
    u = request.user
    if not u.check_password(str(b.get("password") or "")):
        return err("password is incorrect", 403)
    audit(request, "account_deleted", None, u.email)
    with transaction.atomic():
        purge_user_files(u)
        u.delete()
    return JsonResponse({"ok": True})


# ---- e-mail flows (uniform responses: never reveal whether an address has an account) ----
@api(("POST",), auth=False)
def verify(request):
    b = parse_json(request) or {}
    raw = str(b.get("token") or "")
    t = EmailToken.consume(raw, EmailToken.VERIFY)
    if t:
        Profile.of(t.user)
        Profile.objects.filter(user=t.user).update(email_verified=True)
        audit(request, "email_verified", t.user)
        access.claim_invites(t.user)
        if settings.SMTP_ENABLED:
            emails.send_welcome(request, t.user)
        return JsonResponse({"ok": True, "verified": True})
    return err("this link is invalid or has expired", 400)


def cooldown(key, base=None):
    """Server-enforced resend cooldown, doubling per use within 24 h (cap 1 h). -> (seconds_left, allowed_now)"""
    from datetime import timedelta

    base = base or settings.EMAIL_RESEND_SECONDS
    now = timezone.now()
    c, _ = Cooldown.objects.get_or_create(key=key[:190])
    if c.updated_at < now - timedelta(hours=24):
        c.count, c.until = 0, None
    if c.until and c.until > now:
        return int((c.until - now).total_seconds()) + 1, False
    c.count += 1
    c.until = now + timedelta(seconds=min(3600, base * 2 ** (c.count - 1)))
    c.updated_at = now
    c.save()
    return int((c.until - now).total_seconds()), True


@api(("POST",), auth=False)
def resend(request):
    b = parse_json(request) or {}
    email = _norm_email(b.get("email"))
    ip = client_ip(request)
    if security.is_blocked(request, email) or not hit(f"resendip:{ip}", 10, 3600):
        return err("too many attempts, try again later", 429)
    if not powmod.verify(request, "resend", b.get("pow")):
        return err("please retry (proof of work failed)", 400, code="pow-required")
    wait, ok = cooldown(f"resend:{ip}|{email}")
    if ok and email:
        u = User.objects.filter(email=email, is_active=True).first()
        if u and not Profile.of(u).email_verified and settings.SMTP_ENABLED:
            emails.send_verify(request, u, EmailToken.issue(u, EmailToken.VERIFY))
    return JsonResponse({"ok": True, "retryAfter": wait})  # identical whether or not anything was sent


@api(("POST",), auth=False)
def forgot(request):
    if not settings.SMTP_ENABLED:
        return err("Password reset by e-mail is not available on this server. Ask an administrator to reset it.", 501)
    b = parse_json(request) or {}
    email = _norm_email(b.get("email"))
    ip = client_ip(request)
    if security.is_blocked(request, email) or not hit(f"forgotip:{ip}", 10, 3600):
        return err("too many attempts, try again later", 429)
    if str(b.get("website") or "").strip() or (b.get("elapsedMs") is not None and int(b.get("elapsedMs") or 0) < 800):
        return JsonResponse({"ok": True, "retryAfter": 60})  # bot traps answer like a normal request
    if not powmod.verify(request, "forgot", b.get("pow")):
        return err("please retry (proof of work failed)", 400, code="pow-required")
    wait, ok = cooldown(f"forgot:{ip}|{email}")
    if ok and email:
        u = User.objects.filter(email=email, is_active=True).first()
        if u:
            emails.send_reset(request, u, EmailToken.issue(u, EmailToken.RESET))
            audit(request, "password_reset_requested", u)
    return JsonResponse({"ok": True, "retryAfter": wait})


@api(("GET",), auth=False)
def pow_challenge(request):
    purpose = request.GET.get("purpose", "")
    if purpose not in ("register", "forgot", "resend"):
        return err("bad purpose", 400)
    return JsonResponse(powmod.issue(request, purpose))


@api(("POST",), auth=False)
def reset(request):
    b = parse_json(request) or {}
    if not hit(f"resetip:{client_ip(request)}", 20, 3600):
        return err("too many attempts, try again later", 429)
    new = str(b.get("newPassword") or "")
    pre = EmailToken.objects.select_related("user").filter(token_hash=hash_key(str(b.get("token") or "")), purpose=EmailToken.RESET, used=False).first()
    if not pre or pre.expires_at <= timezone.now():
        return err("this link is invalid or has expired", 400)
    msg = _check_password(new, pre.user)  # validate first so a weak password does not burn the link
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


@api(("GET",))
def devices(request):
    cur = request.token.device_id
    out = [{"id": d.device_id, "name": d.name, "browser": d.browser, "os": d.os, "kind": d.kind, "createdAt": d.created_at.isoformat(),
            "lastSeen": d.last_seen.isoformat(), "current": d.pk == cur, "active": d.tokens.filter(expires_at__gt=timezone.now()).exists()}
           for d in Device.objects.filter(user=request.user).order_by("-last_seen")]  # own devices only; no IPs
    return JsonResponse({"devices": out})


@api(("DELETE", "POST"))
def device_detail(request, device_id):
    n, _ = Device.objects.filter(user=request.user, device_id=device_id).delete()
    if not n:
        return err("not found", 404)
    return JsonResponse({"ok": True, "revoked": device_id})


def temp_password():
    """Always satisfies the password rules (upper, lower, number, 10+ chars)."""
    return secrets.token_urlsafe(9) + "-Aa" + str(secrets.randbelow(90) + 10)


@api(("POST",))
def twofa_setup(request):
    p = Profile.of(request.user)
    if p.totp_enabled:
        return err("two-factor is already enabled", 409)
    p.totp_secret = totp.new_secret()
    p.save(update_fields=["totp_secret"])
    return JsonResponse({"secret": p.totp_secret, "otpauth": totp.uri(p.totp_secret, request.user.email)})


@api(("POST",))
def twofa_enable(request):
    import json as _j

    p = Profile.of(request.user)
    step = totp.verify(p.totp_secret, (parse_json(request) or {}).get("code")) if p.totp_secret else None
    if not step:
        return err("that code is not correct", 400)
    codes, hashes = totp.new_recovery()
    p.totp_enabled, p.totp_last_step, p.recovery_hashes = True, step, _j.dumps(hashes)
    p.save()
    audit(request, "2fa_enabled", request.user)
    return JsonResponse({"ok": True, "recoveryCodes": codes})  # shown once


@api(("POST",))
def twofa_disable(request):
    b = parse_json(request) or {}
    p = Profile.of(request.user)
    if not request.user.check_password(str(b.get("password") or "")) or not totp.verify(p.totp_secret, b.get("code"), p.totp_last_step):
        return err("password or code is incorrect", 403)
    p.totp_enabled, p.totp_secret, p.recovery_hashes = False, "", "[]"
    p.save()
    Device.objects.filter(user=request.user).update(trusted_until=None)
    audit(request, "2fa_disabled", request.user)
    return JsonResponse({"ok": True})


@api(("POST",))
def logout_all(request):
    Token.objects.filter(user=request.user).exclude(pk=request.token.pk).delete()
    audit(request, "logout_all", request.user)
    return JsonResponse({"ok": True})


@api(("GET", "PUT"))
def account_settings(request):
    """Small JSON blob of app settings that follows the account (last write wins)."""
    import json as _j

    p = Profile.of(request.user)
    if request.method == "PUT":
        b = parse_json(request) or {}
        data, at = b.get("settings"), int(b.get("updatedAt") or 0)
        if not isinstance(data, dict) or len(_j.dumps(data)) > 32768:
            return err("settings must be a JSON object up to 32 KB", 413)
        try:
            validate._walk(data, 0, [5000])
        except ValueError as e:
            return err(str(e))
        if at and at < p.settings_at:
            return JsonResponse({"conflict": True, "updatedAt": p.settings_at})
        p.settings_json, p.settings_at = _j.dumps(data), min(at or now_ms(), now_ms() + 300000)
        p.save(update_fields=["settings_json", "settings_at"])
        return JsonResponse({"ok": True, "updatedAt": p.settings_at})
    return JsonResponse({"settings": _j.loads(p.settings_json) if p.settings_json else None, "updatedAt": p.settings_at})
