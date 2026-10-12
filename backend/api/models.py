import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

KINDS = ("notebooks", "notes", "assets")


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def now_ms() -> int:
    return int(timezone.now().timestamp() * 1000)


def new_uid():
    return uuid.uuid4().hex


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _norm(self, email):
        return (email or "").strip().lower()

    def create_user(self, email, password=None, **extra):
        email = self._norm(email)
        if not email:
            raise ValueError("email is required")
        u = self.model(email=email, **extra)
        u.set_password(password)
        u.save(using=self._db)
        return u

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)

    def get_by_natural_key(self, email):
        return self.get(email=self._norm(email))


class User(AbstractBaseUser, PermissionsMixin):
    """Accounts are identified by e-mail only (stored lower-case). `public_id` is the only id ever exposed."""

    email = models.EmailField(unique=True, max_length=254)
    display_name = models.CharField(max_length=60, blank=True, default="")
    public_id = models.CharField(max_length=32, unique=True, default=new_uid)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def save(self, *a, **kw):
        self.email = (self.email or "").strip().lower()
        super().save(*a, **kw)

    @property
    def display(self):
        return self.display_name or self.email.split("@")[0]

    def __str__(self):
        return self.email


class Device(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    device_id = models.CharField(max_length=64)
    name = models.CharField(max_length=120, blank=True, default="")
    user_agent = models.CharField(max_length=250, blank=True, default="")
    browser = models.CharField(max_length=40, blank=True, default="")
    os = models.CharField(max_length=40, blank=True, default="")
    kind = models.CharField(max_length=12, blank=True, default="")  # desktop|phone|tablet
    first_ip = models.CharField(max_length=45, blank=True, default="")
    last_ip = models.CharField(max_length=45, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now)
    trusted_until = models.DateTimeField(null=True, blank=True)  # "remember this device": skips 2FA

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
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)  # server-side trash clock
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
    avatar_id = models.CharField(max_length=32, blank=True, default="")
    settings_json = models.TextField(default="")
    settings_at = models.BigIntegerField(default=0)
    totp_secret = models.CharField(max_length=40, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)
    totp_last_step = models.BigIntegerField(default=0)
    recovery_hashes = models.TextField(default="[]")
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
    uid = models.CharField(max_length=32, unique=True, default=new_uid)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shares_out")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shares_in")
    kind = models.CharField(max_length=12)  # notes | notebooks
    record_id = models.CharField(max_length=64)
    role = models.CharField(max_length=8, default=VIEWER)
    expires_at = models.DateTimeField(null=True, blank=True)
    via_link = models.BooleanField(default=False)  # created by redeeming a link-share
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("owner", "recipient", "kind", "record_id")]


class PublicLink(models.Model):
    """Link share for a note (kind=notes, with a rendered snapshot) or a notebook (redeem-only)."""

    PRIVATE, INTERNAL, PUBLIC = "private", "internal", "public"
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="public_links")
    uid = models.CharField(max_length=32, unique=True, default=new_uid)
    gen = models.PositiveIntegerField(default=0)
    token_hash = models.CharField(max_length=64, unique=True, blank=True, default="")
    kind = models.CharField(max_length=12, default="notes")
    visibility = models.CharField(max_length=10, default="public")
    permission = models.CharField(max_length=5, default="read")  # read | write
    edits = models.PositiveIntegerField(default=0)
    note_id = models.CharField(max_length=64)
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
        unique_together = [("owner", "kind", "note_id")]

    @property
    def token(self):
        """Derived, never stored: 192-bit HMAC of (uid, generation). Only its hash is in the database."""
        d = hmac.new(settings.SECRET_KEY.encode(), f"link:{self.uid}:{self.gen}".encode(), hashlib.sha256).digest()
        return __import__("base64").urlsafe_b64encode(d[:24]).decode().rstrip("=")

    def rotate(self):
        self.gen += 1
        self.token_hash = hash_key(self.token)

    def save(self, *a, **kw):
        if not self.token_hash:
            self.token_hash = hash_key(self.token)
        super().save(*a, **kw)

    @classmethod
    def by_token(cls, t):
        return cls.objects.filter(token_hash=hash_key(str(t or ""))).first()


class PublicAsset(models.Model):
    link = models.ForeignKey(PublicLink, on_delete=models.CASCADE, related_name="assets")
    key = models.CharField(max_length=40)
    mime = models.CharField(max_length=80, default="application/octet-stream")
    size = models.BigIntegerField(default=0)

    class Meta:
        unique_together = [("link", "key")]


class LoginEvent(models.Model):
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="login_events")
    username = models.CharField(max_length=150, blank=True, default="")
    ip = models.CharField(max_length=45, blank=True, default="", db_index=True)
    user_agent = models.CharField(max_length=250, blank=True, default="")
    browser = models.CharField(max_length=40, blank=True, default="")
    os = models.CharField(max_length=40, blank=True, default="")
    kind = models.CharField(max_length=12, blank=True, default="")
    ok = models.BooleanField(default=True)
    event = models.CharField(max_length=12, default="login")  # login | register | failed | blocked

    class Meta:
        ordering = ["-id"]


class RateBucket(models.Model):
    """DB-backed fixed-window counters (shared hosting has no Redis)."""

    key = models.CharField(max_length=190)
    window = models.BigIntegerField()
    count = models.PositiveIntegerField(default=0)
    expires = models.BigIntegerField(default=0, db_index=True)  # epoch seconds, for lazy cleanup

    class Meta:
        unique_together = [("key", "window")]


class Lockout(models.Model):
    """Exponential lockout after repeated failures, keyed by ip|username."""

    key = models.CharField(max_length=190, unique=True)
    fails = models.PositiveIntegerField(default=0)
    until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(default=timezone.now)


class Block(models.Model):
    IP, EMAIL, DOMAIN = "ip", "email", "domain"
    uid = models.CharField(max_length=32, unique=True, default=new_uid)
    kind = models.CharField(max_length=8)
    value = models.CharField(max_length=190)
    reason = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("kind", "value")]


class Setting(models.Model):
    """Runtime options editable from the in-app admin dashboard (JSON values)."""

    key = models.CharField(max_length=60, primary_key=True)
    value = models.TextField(default="null")


class RtcSignal(models.Model):
    """Short-lived WebRTC signalling rows (polled over plain HTTP)."""

    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    owner_id = models.BigIntegerField()
    note_id = models.CharField(max_length=64)
    from_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    from_peer = models.CharField(max_length=40)
    to_peer = models.CharField(max_length=40, blank=True, default="")
    type = models.CharField(max_length=16)
    payload = models.TextField(default="{}")

    class Meta:
        indexes = [models.Index(fields=["owner_id", "note_id", "id"])]


class Presence(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    owner_id = models.BigIntegerField()
    note_id = models.CharField(max_length=64)
    state = models.CharField(max_length=10, default="viewing")
    page_id = models.CharField(max_length=64, blank=True, default="")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "owner_id", "note_id")]


class ActivityEvent(models.Model):
    owner_id = models.BigIntegerField()
    note_id = models.CharField(max_length=64)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=24)
    page_id = models.CharField(max_length=64, blank=True, default="")
    count = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [models.Index(fields=["owner_id", "note_id", "id"])]


class UserBlock(models.Model):
    blocker = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocks_out")
    blocked = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocks_in")

    class Meta:
        unique_together = [("blocker", "blocked")]


class AbuseReport(models.Model):
    uid = models.CharField(max_length=32, unique=True, default=new_uid)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    target = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    kind = models.CharField(max_length=10, default="user")  # user | link | note
    ref = models.CharField(max_length=80, blank=True, default="")
    reason = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=10, default="open")
    created_at = models.DateTimeField(default=timezone.now)


class PendingInvite(models.Model):
    """Share invitation for an e-mail that has no account yet; claimed on sign-up."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    email = models.CharField(max_length=254, db_index=True)
    kind = models.CharField(max_length=12)
    record_id = models.CharField(max_length=64)
    role = models.CharField(max_length=8, default="viewer")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("owner", "email", "kind", "record_id")]
