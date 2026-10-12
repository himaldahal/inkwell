import json
import time
from functools import wraps

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import Token, hash_key


def err(msg, status=400, **extra):
    return JsonResponse({"error": msg, **extra}, status=status)


def client_ip(request):
    """Client address. X-Forwarded-For is honoured only when the direct peer is in TRUSTED_PROXIES."""
    ra = request.META.get("REMOTE_ADDR", "0.0.0.0")
    trusted = settings.TRUSTED_PROXIES
    if trusted and ("*" in trusted or ra in trusted):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            hops = [x.strip() for x in xff.split(",") if x.strip()]
            for h in reversed(hops):  # right-most hop that is not one of our proxies
                if h not in trusted:
                    return h[:45]
            return hops[0][:45]
    return ra[:45]


def hit(key, limit, window, db=True):
    """Fixed-window counter; True while under the limit. DB-backed (works on shared hosting, shared
    across workers). db=False uses the local cache (cheap, used for the per-request API limit)."""
    if not limit:
        return True
    w = int(time.time() // window)
    if not db:
        k = f"rl:{key}:{w}"
        if cache.add(k, 1, window + 5):
            return True
        try:
            return cache.incr(k) <= limit
        except ValueError:
            cache.set(k, 1, window + 5)
            return True
    from django.db import transaction
    from django.db.models import F

    from .models import RateBucket

    with transaction.atomic():
        b, _ = RateBucket.objects.get_or_create(key=key[:190], window=w, defaults={"count": 0, "expires": int(time.time()) + 2 * window})
        RateBucket.objects.filter(pk=b.pk).update(count=F("count") + 1)
        b.refresh_from_db()
    if cache.add("rl:gc", 1, 3600):  # lazy cleanup, no cron needed
        RateBucket.objects.filter(expires__lt=int(time.time())).delete()
    return b.count <= limit


def parse_json(request):
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None
    return body if isinstance(body, dict) else None


def bearer(request):
    h = request.headers.get("Authorization", "")
    parts = h.split(None, 1)
    if len(parts) == 2 and parts[0].lower() in ("bearer", "token"):
        return parts[1].strip()
    return None


def authenticate(request):
    key = bearer(request)
    if not key:
        return None
    t = Token.objects.select_related("user", "device").filter(key_hash=hash_key(key)).first()
    if not t or not t.user.is_active:
        return None
    now = timezone.now()
    if not cache.get(f"act:{t.user_id}:{now.date()}"):  # cheap per-day marker
        _mark_active(t.user, now)
        cache.set(f"act:{t.user_id}:{now.date()}", 1, 86400)
    if t.expires_at <= now:
        t.delete()
        return None
    # sliding expiry, written at most hourly to keep reads cheap
    if (now - t.last_used).total_seconds() > 3600:
        from datetime import timedelta

        t.last_used = now
        t.expires_at = now + timedelta(days=settings.TOKEN_TTL_DAYS)
        t.save(update_fields=["last_used", "expires_at"])
        _mark_active(t.user, now)
        if t.device_id:
            t.device.last_seen = now
            t.device.save(update_fields=["last_seen"])
    return t


def api(methods=("GET",), auth=True, perm=None, pw_ok=False):
    """CSRF-exempt token API view with method check, auth and light rate limiting.
    perm="x.y" (or {method: perm}): RBAC permission required. pw_ok=True: reachable while a password change is still required."""

    def deco(fn):
        @csrf_exempt
        @wraps(fn)
        def wrapper(request, *a, **kw):
            if request.method == "OPTIONS":
                return JsonResponse({})
            bad_method = request.method not in methods and not (request.method == "HEAD" and "GET" in methods)
            if bad_method and not auth:
                return err("method not allowed", 405)
            if auth:
                t = authenticate(request)
                if not t:
                    return err("unauthorized", 401)
                if not hit(f"tok:{t.pk}", settings.RATE_LIMIT_API, 60, db=False):
                    return err("rate limited", 429)
                request.user, request.token = t.user, t
                if bad_method:
                    return err("method not allowed", 405)
                if perm is not None:
                    from . import rbac

                    need = perm.get(request.method) if isinstance(perm, dict) else perm
                    if not need or not rbac.has_perm(t.user, need):
                        return err("forbidden", 403)
                if not pw_ok:
                    from .models import Profile

                    if Profile.of(t.user).must_change_password:
                        return err("password change required", 403, code="password-change-required")
            return fn(request, *a, **kw)

        wrapper.perm = perm
        return wrapper

    return deco


def enc_cursor(user, seq):
    """Opaque, signed pagination cursor (hides the global counter)."""
    from django.core import signing

    return signing.dumps(int(seq), salt=f"cursor:{user.pk}", compress=False)


def dec_cursor(user, value):
    from django.core import signing

    if value in (None, "", "0", 0):
        return 0
    try:
        return int(signing.loads(str(value), salt=f"cursor:{user.pk}"))
    except (signing.BadSignature, ValueError):
        raise ValueError("bad cursor")


def public_user(u):
    """What other users may see about someone: never e-mail, never IP."""
    return {"id": u.public_id, "name": u.display, "avatar": avatar_of(u)}


def avatar_of(u):
    p = getattr(u, "profile", None)
    try:
        from .models import Profile

        return Profile.of(u).avatar_id or None
    except Exception:  # noqa: BLE001
        return None


def _mark_active(user, now):
    from .models import ActiveDay

    ActiveDay.objects.get_or_create(user=user, day=now.date())
