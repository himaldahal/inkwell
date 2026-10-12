"""Runtime settings editable from the admin dashboard (fall back to env/defaults)."""
import json

from django.conf import settings
from django.core.cache import cache

from .models import Setting


def _all():
    d = cache.get("rt:settings")
    if d is None:
        d = {s.key: json.loads(s.value or "null") for s in Setting.objects.all()}
        cache.set("rt:settings", d, 20)
    return d


def get(key, default=None):
    v = _all().get(key)
    return default if v is None else v


def put(key, value):
    Setting.objects.update_or_create(key=key, defaults={"value": json.dumps(value)})
    cache.delete("rt:settings")


def registration_open():
    v = get("registration_open")
    return bool(settings.ALLOW_REGISTRATION if v is None else v)


def anonymous_links_allowed():
    """Commercial: allowed. Internal: only if a superuser enabled it."""
    v = get("allow_anonymous_links")
    return (settings.DEPLOYMENT_MODE == "commercial") if v is None else bool(v)


def domain_lists():
    return [d.lower() for d in get("email_allow_domains", [])], [d.lower() for d in get("email_deny_domains", [])]


DISPOSABLE = {"mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com",
              "throwawaymail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "dispostable.com", "fakeinbox.com"}
