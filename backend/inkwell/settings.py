"""Inkwell settings. Everything is configurable through environment variables
or a `.env` file next to manage.py (see .env.example)."""
import logging
import os
import secrets
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
    if DEBUG:
        return "insecure-dev-key-inkwell"
    # Convenience for first boot on shared hosting: generate once and persist.
    f = BASE_DIR / ".secret_key"
    try:
        if f.is_file():
            return f.read_text().strip()
        key = secrets.token_urlsafe(60)
        f.write_text(key)
        logging.getLogger(__name__).warning("SECRET_KEY not set; generated %s", f)
        return key
    except OSError:
        logging.getLogger(__name__).warning("SECRET_KEY not set and not writable; using an ephemeral key")
        return secrets.token_urlsafe(60)


SECRET_KEY = _secret_key()
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "*" if DEBUG else "localhost,127.0.0.1,[::1]")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if env_bool("TRUST_PROXY", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True

# ---- Inkwell specific -------------------------------------------------------
ALLOW_REGISTRATION = env_bool("ALLOW_REGISTRATION", True)
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
TRUST_PROXY = env_bool("TRUST_PROXY", False)

# ---- Apps -------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "inkwell.middleware.CorsMiddleware",
    "inkwell.middleware.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "inkwell.urls"
WSGI_APPLICATION = "inkwell.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

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
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# ---- Files ------------------------------------------------------------------
MEDIA_ROOT = Path(env("MEDIA_ROOT") or (BASE_DIR / "media"))
STATIC_URL = "/django-static/"  # admin assets only; the app itself is served from the root
STATIC_ROOT = Path(env("STATIC_ROOT") or (BASE_DIR / "staticfiles"))
APP_DIR = BASE_DIR / "inkwell" / "static_app"  # built frontend (committed)
WHITENOISE_ROOT = APP_DIR if APP_DIR.is_dir() else None
WHITENOISE_INDEX_FILE = True
WHITENOISE_MANIFEST_STRICT = False
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
WHITENOISE_IMMUTABLE_FILE_TEST = lambda path, url: "/assets/" in url  # noqa: E731
WHITENOISE_ADD_HEADERS_FUNCTION = "inkwell.headers.add_headers"

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
CSP_CONNECT_SRC = env("CSP_CONNECT_SRC", "'self' https:")
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
