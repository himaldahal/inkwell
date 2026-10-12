"""Server-side trash. Deleting = tombstone (kept for sync) whose content stays restorable for TRASH_RETENTION_DAYS."""
import json
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .models import Record, now_ms


def purge_expired(days=None, user=None):
    days = settings.TRASH_RETENTION_DAYS if days is None else days
    qs = Record.objects.filter(deleted=True, deleted_at__lt=timezone.now() - timedelta(days=days)).exclude(data="{}")
    if user is not None:
        qs = qs.filter(user=user)
    return purge_qs(qs)


def purge_qs(qs):
    n = 0
    for r in qs.exclude(data="{}"):
        r.data = "{}"
        r.save(update_fields=["data"])
        n += 1
    return n


def maybe_cleanup():
    """Opportunistic cleanup (hourly per process) so no cron is required."""
    if settings.TRASH_RETENTION_DAYS and cache.add("trash:gc", 1, 3600):
        try:
            purge_expired()
        except Exception:  # noqa: BLE001
            pass


def trash_json(r):
    try:
        d = json.loads(r.data)
    except ValueError:
        d = {}
    left = None
    if r.deleted_at and settings.TRASH_RETENTION_DAYS:
        left = max(0, settings.TRASH_RETENTION_DAYS - (timezone.now() - r.deleted_at).days)
    return {"kind": r.kind, "id": r.record_id, "title": d.get("title") or d.get("name") or "",
            "deletedAt": int(r.deleted_at.timestamp() * 1000) if r.deleted_at else None, "daysLeft": left}


def restore(r, seq):
    try:
        d = json.loads(r.data)
    except ValueError:
        d = {}
    d["deleted"] = False
    r.updated_at = max(now_ms(), r.updated_at + 1)
    d["updatedAt"] = r.updated_at
    r.data = json.dumps(d, separators=(",", ":"), ensure_ascii=False)
    r.deleted, r.deleted_at, r.seq = False, None, seq
    r.save()
