"""Abuse controls: IP/email blocks, exponential lockout, login history, e-mail policy."""
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from . import runtime
from .models import Block, Lockout, LoginEvent
from .useragent import parse_ua
from .util import client_ip


def is_blocked(request, email=""):
    now = timezone.now()
    live = Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    q = Q(kind=Block.IP, value=client_ip(request))
    email = (email or "").strip().lower()
    if email:
        q |= Q(kind=Block.EMAIL, value=email) | Q(kind=Block.DOMAIN, value=email.rsplit("@", 1)[-1])
    return Block.objects.filter(live).filter(q).exists()


def email_policy_error(email):
    """None when the address may register, else a message."""
    domain = email.rsplit("@", 1)[-1].lower()
    allow, deny = runtime.domain_lists()
    if allow and domain not in allow:
        return "registration is limited to approved e-mail domains"
    if domain in deny or domain in runtime.DISPOSABLE:
        return "please use a permanent e-mail address"
    return None


def lockout_remaining(key):
    lo = Lockout.objects.filter(key=key[:190]).first()
    if lo and lo.until and lo.until > timezone.now():
        return int((lo.until - timezone.now()).total_seconds()) + 1
    return 0


def register_failure(key, after=5):
    lo, _ = Lockout.objects.get_or_create(key=key[:190])
    lo.fails += 1
    if lo.fails >= after:  # 30s, 60s, 120s ... capped at 1 hour
        lo.until = timezone.now() + timedelta(seconds=min(3600, 30 * 2 ** (lo.fails - after)))
    lo.updated_at = timezone.now()
    lo.save()
    return lo


def clear_failures(key):
    Lockout.objects.filter(key=key[:190]).delete()


def record_event(request, user, username, event, ok=True):
    b, o, k = parse_ua(request.headers.get("User-Agent", ""))
    return LoginEvent.objects.create(
        user=user, username=(username or "")[:150], ip=client_ip(request), user_agent=request.headers.get("User-Agent", "")[:250],
        browser=b, os=o, kind=k, ok=ok, event=event,
    )
