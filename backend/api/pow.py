"""Hashcash proof-of-work (captcha-free). Challenges are HMAC-signed, IP-bound, expire after 10 minutes and are single use.
Difficulty rises automatically while abuse is detected from the requesting IP."""
import hashlib
import hmac
import secrets
import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .util import client_ip, hit


def _sig(payload):
    return hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:20]


def _ipd(request):
    return hashlib.sha256(client_ip(request).encode()).hexdigest()[:10]


def difficulty(request):
    from .models import AuditLog, LoginEvent

    since = timezone.now() - timedelta(hours=1)
    bad = LoginEvent.objects.filter(ip=client_ip(request), ok=False, created_at__gte=since).count()
    if bad >= 5 or AuditLog.objects.filter(event="mail.alert", created_at__gte=since).exists():
        return settings.POW_BITS_ABUSE
    return settings.POW_BITS


def issue(request, purpose):
    d = difficulty(request)
    payload = f"{purpose}:{int(time.time())}:{d}:{_ipd(request)}:{secrets.token_hex(6)}"
    return {"challenge": f"{payload}:{_sig(payload)}", "difficulty": d}


def _bits_ok(digest_hex, bits):
    n = int(digest_hex, 16)
    return n >> (256 - bits) == 0


def verify(request, purpose, proof):
    if not settings.POW_REQUIRED:
        return True
    try:
        ch, nonce = str(proof["challenge"]), str(proof["nonce"])[:40]
        payload, sig = ch.rsplit(":", 1)
        p, ts, d, ipd, _ = payload.split(":")
        if (p != purpose or not hmac.compare_digest(sig, _sig(payload)) or ipd != _ipd(request) or time.time() - int(ts) > 600
                or int(d) < difficulty(request)):
            return False
        if not _bits_ok(hashlib.sha256(f"{ch}:{nonce}".encode()).hexdigest(), int(d)):
            return False
        return hit("pow:" + hashlib.sha256(ch.encode()).hexdigest()[:40], 1, 700)  # single use
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
