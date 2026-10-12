import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

KINDS = ("notebooks", "notes", "assets")


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def now_ms() -> int:
    return int(timezone.now().timestamp() * 1000)


class Device(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    device_id = models.CharField(max_length=64)
    name = models.CharField(max_length=120, blank=True, default="")
    user_agent = models.CharField(max_length=250, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "device_id")]

    def __str__(self):
        return f"{self.user_id}:{self.name or self.device_id}"


class Token(models.Model):
    """Bearer token. Only the sha256 of the key is stored (the key is shown once)."""

    key_hash = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_tokens")
    device = models.ForeignKey(Device, null=True, blank=True, on_delete=models.CASCADE, related_name="tokens")
    created_at = models.DateTimeField(default=timezone.now)
    last_used = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()

    @classmethod
    def issue(cls, user, device=None):
        key = secrets.token_urlsafe(40)
        t = cls.objects.create(
            key_hash=hash_key(key),
            user=user,
            device=device,
            expires_at=timezone.now() + timedelta(days=settings.TOKEN_TTL_DAYS),
        )
        return key, t


class SeqCounter(models.Model):
    """Single row: global monotonic change counter."""

    value = models.BigIntegerField(default=0)


class Record(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="records")
    kind = models.CharField(max_length=12)
    record_id = models.CharField(max_length=64)
    updated_at = models.BigIntegerField()
    deleted = models.BooleanField(default=False)
    seq = models.BigIntegerField(db_index=True)
    data = models.TextField(default="{}")  # JSON text (portable sqlite/MySQL)

    class Meta:
        unique_together = [("user", "kind", "record_id")]
        indexes = [
            models.Index(fields=["user", "seq"]),
            models.Index(fields=["user", "kind", "updated_at"]),
            models.Index(fields=["user", "deleted"]),
        ]


class AssetBlob(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blobs")
    asset_id = models.CharField(max_length=64)
    size = models.BigIntegerField(default=0)
    mime = models.CharField(max_length=120, default="application/octet-stream")
    path = models.CharField(max_length=300)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "asset_id")]
