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
    if settings.TRUST_PROXY:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "0.0.0.0")


def hit(key, limit, window):
    """Fixed-window counter. Returns True while under the limit."""
    if not limit:
        return True
    k = f"rl:{key}:{int(time.time() // window)}"
    if cache.add(k, 1, window + 5):
        return True
    try:
        return cache.incr(k) <= limit
    except ValueError:
        cache.set(k, 1, window + 5)
        return True


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
    if t.expires_at <= now:
        t.delete()
        return None
    # sliding expiry, written at most hourly to keep reads cheap
    if (now - t.last_used).total_seconds() > 3600:
        from datetime import timedelta

        t.last_used = now
        t.expires_at = now + timedelta(days=settings.TOKEN_TTL_DAYS)
        t.save(update_fields=["last_used", "expires_at"])
        if t.device_id:
            t.device.last_seen = now
            t.device.save(update_fields=["last_seen"])
    return t


def api(methods=("GET",), auth=True, staff=False, pw_ok=False):
    """CSRF-exempt token API view with method check, auth and light rate limiting.
    staff=True: administrators only. pw_ok=True: reachable while a password change is still required."""

    def deco(fn):
        @csrf_exempt
        @wraps(fn)
        def wrapper(request, *a, **kw):
            if request.method == "OPTIONS":
                return JsonResponse({})
            if request.method not in methods and not (request.method == "HEAD" and "GET" in methods):
                return err("method not allowed", 405)
            if auth:
                t = authenticate(request)
                if not t:
                    return err("unauthorized", 401)
                if not hit(f"tok:{t.pk}", settings.RATE_LIMIT_API, 60):
                    return err("rate limited", 429)
                request.user, request.token = t.user, t
                if staff and not t.user.is_staff:
                    return err("forbidden", 403)
                if not pw_ok:
                    from .models import Profile

                    if Profile.of(t.user).must_change_password:
                        return err("password change required", 403, code="password-change-required")
            return fn(request, *a, **kw)

        return wrapper

    return deco
