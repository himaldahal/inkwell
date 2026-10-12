"""Inkwell settings. Everything is configurable through environment variables
or a `.env` file next to manage.py (see .env.example)."""
import logging
import os
import secrets
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        os.environ.setdefault(k, v)


_load_dotenv(BASE_DIR / ".env")


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def env_list(name, default=""):
    return [x.strip() for x in env(name, default).split(",") if x.strip()]


DEBUG = env_bool("DEBUG", False)


def _secret_key():
    key = env("SECRET_KEY")
    if key:
        return key
    if DEBUG or "test" in sys.argv[:2]:
        return "insecure-dev-key-inkwell"
    raise ImproperlyConfigured("SECRET_KEY is not set. Put a long random value in backend/.env (see .env.example).")


SECRET_KEY = _secret_key()
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "*" if DEBUG else "localhost,127.0.0.1,[::1]")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if env_bool("TRUST_PROXY", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True

# ---- Inkwell specific -------------------------------------------------------
DEPLOYMENT_MODE = "commercial" if env("DEPLOYMENT_MODE", "internal").strip().lower() == "commercial" else "internal"
# internal: accounts are created by staff only. commercial: public sign-up.
ALLOW_REGISTRATION = env_bool("ALLOW_REGISTRATION", DEPLOYMENT_MODE == "commercial")
APP_URL = env("APP_URL", "").rstrip("/")  # public https origin used in e-mail links; derived from the request if blank
DEFAULT_NOTE_LIMIT = env_int("DEFAULT_NOTE_LIMIT", 0)  # 0 = unlimited (editable per plan in admin)
SHARE_RATE_LIMIT = env_int("SHARE_RATE_LIMIT", 30)  # share-by-email invitations per hour per user
PUBLIC_VIEW_RATE = env_int("PUBLIC_VIEW_RATE", 120)  # public page views per minute per IP
PUBLIC_PASSWORD_ATTEMPTS = env_int("PUBLIC_PASSWORD_ATTEMPTS", 8)  # per 10 minutes per IP+link
PUBLIC_MAX_ASSET_BYTES = env_int("PUBLIC_MAX_ASSET_MB", 25) * 1024 * 1024
PUBLIC_MAX_PAGES = env_int("PUBLIC_MAX_PAGES", 200)
PUBLIC_MAX_TEXT_BYTES = env_int("PUBLIC_MAX_TEXT_MB", 2) * 1024 * 1024
EMAIL_TOKEN_TTL_HOURS = env_int("EMAIL_TOKEN_TTL_HOURS", 24)
EMAIL_RESEND_SECONDS = env_int("EMAIL_RESEND_SECONDS", 60)

# ---- E-mail (all via env). Without EMAIL_HOST mail is printed to the console/log.
EMAIL_HOST = env("EMAIL_HOST", "")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env("EMAIL_USER", env("EMAIL_HOST_USER", ""))
EMAIL_HOST_PASSWORD = env("EMAIL_PASSWORD", env("EMAIL_HOST_PASSWORD", ""))
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", False)
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", not EMAIL_USE_SSL)
EMAIL_TIMEOUT = 15
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", EMAIL_HOST_USER or "Inkwell <noreply@localhost>")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
SMTP_ENABLED = bool(EMAIL_HOST)
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend" if SMTP_ENABLED else "django.core.mail.backends.console.EmailBackend"
REQUIRE_EMAIL_VERIFICATION = env_bool("REQUIRE_EMAIL_VERIFICATION", DEPLOYMENT_MODE == "commercial" and SMTP_ENABLED)
ASSET_QUOTA_BYTES = env_int("ASSET_QUOTA_MB", 2048) * 1024 * 1024  # 0 = unlimited
ASSET_MAX_BYTES = env_int("ASSET_MAX_MB", 200) * 1024 * 1024
MAX_PUSH_BYTES = env_int("MAX_PUSH_MB", 25) * 1024 * 1024
MAX_PUSH_RECORDS = env_int("MAX_PUSH_RECORDS", 500)
MAX_RECORD_BYTES = env_int("MAX_RECORD_MB", 8) * 1024 * 1024
PULL_PAGE_SIZE = env_int("PULL_PAGE_SIZE", 200)
PULL_MAX_BYTES = env_int("PULL_MAX_MB", 8) * 1024 * 1024
RATE_LIMIT_AUTH = env_int("RATE_LIMIT_AUTH", 20)        # login/register attempts per minute per IP
RATE_LIMIT_API = env_int("RATE_LIMIT_API", 600)         # authenticated requests per minute per token
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")  # '*' allowed (token auth, no cookies)
TRUST_PROXY = env_bool("TRUST_PROXY", False)  # scheme only (X-Forwarded-Proto); client IPs use TRUSTED_PROXIES
TRUSTED_PROXIES = env_list("TRUSTED_PROXIES")  # IPs whose X-Forwarded-For is believed; '*' = any (only behind a proxy you control)
TRASH_RETENTION_DAYS = env_int("TRASH_RETENTION_DAYS", 60)
LONGPOLL = env_bool("LONGPOLL", False)
LONGPOLL_MAX_SECONDS = env_int("LONGPOLL_MAX_SECONDS", 20)
STUN_URLS = env_list("STUN_URLS", "stun:stun.l.google.com:19302")
TURN_URL = env("TURN_URL", "")
TURN_USERNAME = env("TURN_USERNAME", "")
TURN_CREDENTIAL = env("TURN_CREDENTIAL", "")
TURN_SECRET = env("TURN_SECRET", "")  # shared secret for ephemeral (HMAC) TURN credentials
MAIL_PER_RECIPIENT_HOURLY = env_int("MAIL_PER_RECIPIENT_HOURLY", 3)
MAIL_PER_RECIPIENT_DAILY = env_int("MAIL_PER_RECIPIENT_DAILY", 10)
MAIL_PER_ACCOUNT_HOURLY = env_int("MAIL_PER_ACCOUNT_HOURLY", 10)
MAIL_PER_MINUTE = env_int("MAIL_PER_MINUTE", 20)  # send throttle for the DB queue
INVITES_PER_DAY = env_int("INVITES_PER_DAY", 20)
INVITES_PER_ADDRESS_DAILY = env_int("INVITES_PER_ADDRESS_DAILY", 2)
POW_REQUIRED = env_bool("POW_REQUIRED", "test" not in sys.argv[:2])  # hashcash on register/forgot/resend
POW_BITS = env_int("POW_BITS", 12)
POW_BITS_ABUSE = env_int("POW_BITS_ABUSE", 17)
MAIL_PER_IP_HOURLY = env_int("MAIL_PER_IP_HOURLY", 20)
MAIL_GLOBAL_HOURLY = env_int("MAIL_GLOBAL_HOURLY", 200)
LOCKOUT_AFTER = env_int("LOCKOUT_AFTER", 5)

# ---- Apps -------------------------------------------------------------------
AUTH_USER_MODEL = "api.User"

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "inkwell.middleware.CorsMiddleware",
    "inkwell.middleware.SecurityHeadersMiddleware",
    "api.metrics.MetricsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "inkwell.urls"
WSGI_APPLICATION = "inkwell.wsgi.application"

# ---- Database ---------------------------------------------------------------
if env("DB_ENGINE", "sqlite").lower().startswith("mysql"):
    try:  # PyMySQL is pure python; use it when mysqlclient is missing
        import MySQLdb  # noqa: F401
    except ImportError:
        try:
            import pymysql

            pymysql.install_as_MySQLdb()
        except ImportError:
            pass
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.mysql",
            "NAME": env("DB_NAME", "inkwell"),
            "USER": env("DB_USER", ""),
            "PASSWORD": env("DB_PASSWORD", ""),
            "HOST": env("DB_HOST", "localhost"),
            "PORT": env("DB_PORT", "3306"),
            "OPTIONS": {"charset": "utf8mb4"},
            "CONN_MAX_AGE": 60,
        }
    }
else:
    _db_path = Path(env("DB_PATH") or (BASE_DIR / "data" / "db.sqlite3"))
    try:
        _db_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": str(_db_path),
            "OPTIONS": {"timeout": 20},
        }
    }
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---- Cache (rate limiting). locmem by default; CACHE_BACKEND=db uses the DB (run createcachetable)
if env("CACHE_BACKEND", "locmem") == "db":
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "inkwell_cache"}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "inkwell"}}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    {"NAME": "api.validators.MixedCaseDigitValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# ---- Files ------------------------------------------------------------------
# ---- Static files (collectstatic -> STATIC_ROOT, served by WhiteNoise at /static/) ----
STATIC_URL = "/static/"
STATIC_ROOT = Path(env("STATIC_ROOT") or (BASE_DIR / "staticfiles"))
STATICFILES_DIRS = [BASE_DIR / "static"] if (BASE_DIR / "static").is_dir() else []
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage" if DEBUG else "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
# ---- User media: NEVER served directly (no URL route, not in WhiteNoise); only via permission-checked views ----
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT") or (BASE_DIR / "media"))
SENDFILE = env("SENDFILE", "none").lower()  # none | apache (X-Sendfile) | nginx (X-Accel-Redirect)
SENDFILE_URL_PREFIX = env("SENDFILE_URL_PREFIX", "/protected-media/")  # nginx internal location that maps to MEDIA_ROOT
for _d, _mode in ((STATIC_ROOT, 0o755), (MEDIA_ROOT, 0o700)):  # created automatically with safe permissions
    try:
        _d.mkdir(parents=True, exist_ok=True)
        if _d is MEDIA_ROOT:
            os.chmod(_d, _mode)
    except OSError:
        pass
APP_DIR = BASE_DIR / "inkwell" / "static_app"  # built frontend (committed)
WHITENOISE_ROOT = APP_DIR if APP_DIR.is_dir() else None
WHITENOISE_INDEX_FILE = True
WHITENOISE_MANIFEST_STRICT = False
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
WHITENOISE_IMMUTABLE_FILE_TEST = lambda path, url: "/assets/" in url  # noqa: E731
def _add_headers(headers, path, url):
    from inkwell.headers import add_headers

    add_headers(headers, path, url)


WHITENOISE_ADD_HEADERS_FUNCTION = _add_headers

DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_PUSH_BYTES
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024

SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SAMESITE = "Lax"
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
# With DEBUG off, HTTPS-only cookies + HSTS are on by default (set HTTPS_ONLY=false to opt out, e.g. plain-http LAN).
if not DEBUG and env_bool("HTTPS_ONLY", True):
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env_int("HSTS_SECONDS", 31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False
    SECURE_SSL_REDIRECT = env_bool("SSL_REDIRECT", False)  # many hosts redirect in .htaccess already
CSP_CONNECT_SRC = env("CSP_CONNECT_SRC", "'self' https:")  # https: already covers tessdata.projectnaptha.com
EMBED_HOSTS = env_list("EMBED_HOSTS", "www.youtube-nocookie.com,player.vimeo.com,docs.google.com,www.loom.com,www.figma.com,www.google.com")  # frame-src allow-list
TOKEN_TTL_DAYS = env_int("TOKEN_TTL_DAYS", 90)  # sliding expiry
RATE_LIMIT_LOGIN = env_int("RATE_LIMIT_LOGIN", 8)  # failed+ok attempts per 5 min per IP+username

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
}

if not SECRET_KEY:
    raise ImproperlyConfigured("SECRET_KEY is required")
