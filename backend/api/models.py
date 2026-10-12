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
    parent_id = models.CharField(max_length=64, blank=True, default="", db_index=True)  # notes: notebookId, assets: noteId
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


class Plan(models.Model):
    """Storage/note limits. Editable in the admin; the one flagged default applies to users without a plan."""

    name = models.CharField(max_length=60, unique=True)
    storage_mb = models.PositiveIntegerField(default=1024, help_text="0 = unlimited")
    max_notes = models.PositiveIntegerField(default=0, help_text="0 = unlimited")
    is_default = models.BooleanField(default=False)

    def __str__(self):
        return self.name

    @classmethod
    def default(cls):
        p = cls.objects.filter(is_default=True).first()
        if not p:
            p = cls.objects.create(
                name="Default", storage_mb=settings.ASSET_QUOTA_BYTES // (1024 * 1024),
                max_notes=settings.DEFAULT_NOTE_LIMIT, is_default=True,
            )
        return p


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.SET_NULL)
    storage_mb_override = models.PositiveIntegerField(null=True, blank=True)
    max_notes_override = models.PositiveIntegerField(null=True, blank=True)
    email_verified = models.BooleanField(default=False)
    must_change_password = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    @classmethod
    def of(cls, user):
        p, _ = cls.objects.get_or_create(
            user=user, defaults={"email_verified": settings.DEPLOYMENT_MODE == "internal" or user.is_staff})
        return p

    def quota_bytes(self):
        mb = self.storage_mb_override
        if mb is None:
            mb = (self.plan or Plan.default()).storage_mb
        return mb * 1024 * 1024

    def note_limit(self):
        n = self.max_notes_override
        if n is None:
            n = (self.plan or Plan.default()).max_notes
        return n


class EmailToken(models.Model):
    """Single-use, expiring link token (stored hashed)."""

    VERIFY, RESET, CHANGE = "verify", "reset", "change_email"
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="email_tokens")
    purpose = models.CharField(max_length=16)
    token_hash = models.CharField(max_length=64, unique=True)
    new_email = models.CharField(max_length=254, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    @classmethod
    def issue(cls, user, purpose, new_email="", hours=None):
        raw = secrets.token_urlsafe(32)
        cls.objects.filter(user=user, purpose=purpose, used=False).update(used=True)  # invalidate older links
        cls.objects.create(
            user=user, purpose=purpose, token_hash=hash_key(raw), new_email=new_email,
            expires_at=timezone.now() + timedelta(hours=hours or settings.EMAIL_TOKEN_TTL_HOURS),
        )
        return raw

    @classmethod
    def consume(cls, raw, purpose):
        t = cls.objects.select_related("user").filter(token_hash=hash_key(raw or ""), purpose=purpose, used=False).first()
        if not t or t.expires_at <= timezone.now():
            return None
        t.used = True
        t.save(update_fields=["used"])
        return t


class AuditLog(models.Model):
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor = models.CharField(max_length=150, blank=True, default="")
    event = models.CharField(max_length=40, db_index=True)
    detail = models.CharField(max_length=300, blank=True, default="")
    ip = models.CharField(max_length=45, blank=True, default="")

    class Meta:
        ordering = ["-id"]


class Share(models.Model):
    VIEWER, EDITOR = "viewer", "editor"
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shares_out")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shares_in")
    kind = models.CharField(max_length=12)  # notes | notebooks
    record_id = models.CharField(max_length=64)
    role = models.CharField(max_length=8, default=VIEWER)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("owner", "recipient", "kind", "record_id")]


class PublicLink(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="public_links")
    note_id = models.CharField(max_length=64)
    token = models.CharField(max_length=64, unique=True)
    title = models.CharField(max_length=300, blank=True, default="")
    text_html = models.TextField(blank=True, default="")  # sanitized
    pages = models.TextField(default="[]")  # JSON [{key,w,h}]
    password_hash = models.CharField(max_length=200, blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True)
    allow_download = models.BooleanField(default=False)
    revoked = models.BooleanField(default=False)
    views = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("owner", "note_id")]


class PublicAsset(models.Model):
    link = models.ForeignKey(PublicLink, on_delete=models.CASCADE, related_name="assets")
    key = models.CharField(max_length=40)
    mime = models.CharField(max_length=80, default="application/octet-stream")
    size = models.BigIntegerField(default=0)

    class Meta:
        unique_together = [("link", "key")]
