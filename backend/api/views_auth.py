from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Sum
from django.http import JsonResponse
from django.utils import timezone

from .models import AssetBlob, Device, Record, Token, now_ms
from .util import api, bearer, client_ip, err, hit, parse_json

User = get_user_model()


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


def _session(request, user, body):
    dev = _device_for(request, user, body)
    key, _ = Token.issue(user, dev)
    return JsonResponse({"token": key, "user": _user_json(user), "serverTime": now_ms()})


def _user_json(u):
    return {"id": u.pk, "username": u.get_username(), "email": u.email}


def _check_password(pw, user=None):
    try:
        validate_password(pw, user)
    except ValidationError as e:
        return " ".join(e.messages)
    return None


@api(("POST",), auth=False)
def register(request):
    if not settings.ALLOW_REGISTRATION:
        return err("registration is disabled", 403)
    if not hit(f"reg:{client_ip(request)}", settings.RATE_LIMIT_AUTH, 60):
        return err("too many attempts, try again later", 429)
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    username = str(b.get("username") or "").strip()
    password = str(b.get("password") or "")
    email = str(b.get("email") or "").strip()[:254]
    if not (3 <= len(username) <= 60) or any(c.isspace() for c in username):
        return err("username must be 3-60 characters without spaces")
    if User.objects.filter(username__iexact=username).exists():
        return err("username already taken", 409)
    probe = User(username=username, email=email)
    msg = _check_password(password, probe)
    if msg:
        return err(msg)
    user = User.objects.create_user(username=username, email=email, password=password)
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
    pw = str(b.get("password") or "")
    # always run the hasher so timing does not reveal valid usernames
    ok = user.check_password(pw) if user else (User().set_password(pw) or False)
    if not ok or not user.is_active:
        return err("invalid username or password", 401)
    return _session(request, user, b)


@api(("POST",))
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


@api(("GET",))
def me(request):
    u = request.user
    agg = AssetBlob.objects.filter(user=u).aggregate(b=Sum("size"), n=Count("id"))
    recs = Record.objects.filter(user=u, deleted=False).count()
    return JsonResponse(
        {
            "user": _user_json(u),
            "usage": {
                "assetBytes": agg["b"] or 0,
                "assets": agg["n"],
                "records": recs,
                "quotaBytes": settings.ASSET_QUOTA_BYTES,
            },
            "tokenExpires": request.token.expires_at.isoformat(),
            "tokenCreated": request.token.created_at.isoformat(),
            "serverTime": now_ms(),
        }
    )


@api(("POST",))
def change_password(request):
    b = parse_json(request)
    if b is None:
        return err("invalid json")
    u = request.user
    if not u.check_password(str(b.get("oldPassword") or "")):
        return err("current password is incorrect", 403)
    new = str(b.get("newPassword") or "")
    msg = _check_password(new, u)
    if msg:
        return err(msg)
    u.set_password(new)
    u.save()
    Token.objects.filter(user=u).exclude(pk=request.token.pk).delete()  # sign out other devices
    return JsonResponse({"ok": True})


def _purge_user_files(user):
    import shutil

    shutil.rmtree(settings.MEDIA_ROOT / "assets" / str(user.pk), ignore_errors=True)


@api(("POST", "DELETE"))
def delete_account(request):
    b = parse_json(request) or {}
    u = request.user
    if not u.check_password(str(b.get("password") or "")):
        return err("password is incorrect", 403)
    with transaction.atomic():
        _purge_user_files(u)
        u.delete()
    return JsonResponse({"ok": True})


@api(("GET",))
def devices(request):
    cur = request.token.device_id
    out = [
        {
            "id": d.device_id,
            "name": d.name,
            "userAgent": d.user_agent,
            "createdAt": d.created_at.isoformat(),
            "lastSeen": d.last_seen.isoformat(),
            "current": d.pk == cur,
            "active": d.tokens.filter(expires_at__gt=timezone.now()).exists(),
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
