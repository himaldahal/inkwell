"""Server-rendered, read-only public note pages (/s/<token>)."""
import json
from html import escape

from django.conf import settings
from django.core import signing
from django.db.models import F
from django.contrib.auth.hashers import check_password
from django.core.cache import cache
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from . import runtime
from .models import PublicAsset, PublicLink
from .util import client_ip, hit
from .views_share import _public_dir

CSP_T = "default-src 'none'; img-src 'self'; style-src 'nonce-{nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
COOKIE_AGE = 6 * 3600

STYLE = """
:root{color-scheme:light dark;--bg:#f6f3ee;--card:#fff;--text:#1f1d2b;--muted:#6b6880;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#14131c;--card:#1d1c28;--text:#ecebf5;--muted:#9a98b0;--accent:#818cf8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}header{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:1.6rem;margin:0;overflow-wrap:anywhere}.brand{color:var(--muted);font-size:.85rem}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;border:0;border-radius:10px;padding:10px 16px;font:inherit;cursor:pointer}
.page{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12);margin:16px 0;overflow:hidden}.page img{display:block;width:100%;height:auto}
.text{background:var(--card);border-radius:12px;padding:16px 20px;overflow-wrap:anywhere}.text pre{overflow:auto}
form{max-width:360px;margin:15vh auto;background:var(--card);padding:24px;border-radius:14px;display:grid;gap:12px}
input[type=password]{padding:12px;border-radius:10px;border:1px solid var(--muted);background:var(--bg);color:var(--text);font:inherit}
.err{color:#c0392b}.center{text-align:center;margin-top:20vh}
"""


def _page(body, status=200, title="Inkwell"):
    import secrets as _s

    nonce = _s.token_urlsafe(12)
    html = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">'
            f'<title>{escape(title)}</title><style nonce="{nonce}">{STYLE}</style></head><body>{body}</body></html>')
    r = HttpResponse(html, status=status, content_type="text/html; charset=utf-8")
    r["Content-Security-Policy"] = CSP_T.replace("{nonce}", nonce)
    r["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    r["X-Frame-Options"] = "DENY"
    r["Referrer-Policy"] = "no-referrer"
    r["Cache-Control"] = "private, no-store"
    return r


def _gone(msg, status):
    return _page(f'<div class="center"><h1>{escape(msg)}</h1><p class="brand">Inkwell</p></div>', status)


def _get(token):
    link = PublicLink.by_token(token)
    if not link or link.revoked or link.visibility == "private" or link.kind != "notes":
        return None, _gone("This link is not available", 404)
    if link.expires_at and link.expires_at <= timezone.now():
        return None, _gone("This link has expired", 410)
    return link, None


def _needs_login(link):
    """Anonymous viewing only for visibility=public and when the server allows it."""
    return link.visibility != "public" or not runtime.anonymous_links_allowed()


def _login_shell(link):
    return _page(f'<main><form action="/" method="get"><h1>Sign in to view</h1><p class="brand">This note is shared with signed-in members only.</p>'
                 f'<a class="btn" href="/#/s/{escape(link.token)}">Open in Inkwell</a></form></main>', 200)


def _cookie_name(link):
    return "pl_" + link.token[:10]


def _authorized(request, link):
    if not link.password_hash:
        return True
    try:
        return signing.TimestampSigner(salt="public-link").unsign(request.COOKIES.get(_cookie_name(link), ""), max_age=COOKIE_AGE) == f"{link.pk}:{link.password_hash[-12:]}"
    except signing.BadSignature:
        return False


def _password_form(link, error=""):
    return _page('<main><form method="post"><h1>Protected note</h1><p class="brand">Enter the password to view.</p>'
                 + (f'<div class="err">{escape(error)}</div>' if error else "")
                 + '<input type="password" name="password" autocomplete="off" autofocus required aria-label="Password">'
                 '<button class="btn" type="submit">View</button></form></main>', 401 if error else 200)


@csrf_exempt
def public_view(request, token):
    ip = client_ip(request)
    if not hit(f"pubview:{ip}", settings.PUBLIC_VIEW_RATE, 60):
        return _gone("Too many requests", 429)
    if request.method not in ("GET", "HEAD", "POST"):
        return _gone("Method not allowed", 405)
    link, bad = _get(token)
    if bad:
        return bad
    if _needs_login(link):
        return _login_shell(link)
    if link.password_hash and not _authorized(request, link):
        if request.method == "POST":
            if not hit(f"pubpw:{ip}:{link.pk}", settings.PUBLIC_PASSWORD_ATTEMPTS, 600):
                return _gone("Too many attempts. Try again later.", 429)
            if check_password(request.POST.get("password", ""), link.password_hash):
                resp = _render(request, link)
                val = signing.TimestampSigner(salt="public-link").sign(f"{link.pk}:{link.password_hash[-12:]}")
                resp.set_cookie(_cookie_name(link), val, max_age=COOKIE_AGE, httponly=True, samesite="Lax", path="/s/",
                                secure=request.is_secure())
                return resp
            return _password_form(link, "Incorrect password")
        return _password_form(link)
    return _render(request, link)


def _render(request, link):
    if cache.add(f"pubseen:{link.pk}:{client_ip(request)}", 1, 3600):  # unique viewer per hour
        PublicLink.objects.filter(pk=link.pk).update(views=F("views") + 1)
    pages = json.loads(link.pages or "[]")
    keys = set(link.assets.values_list("key", flat=True))
    imgs = "".join(
        f'<div class="page"><img src="/s/{escape(link.token)}/a/{escape(p["key"])}" alt="Page {i + 1}" loading="lazy"'
        + (f' width="{p["w"]}" height="{p["h"]}"' if p.get("w") and p.get("h") else "") + "></div>"
        for i, p in enumerate(pages) if p["key"] in keys)
    edit = f'<a class="btn" href="/#/s/{escape(link.token)}">Open in Inkwell to edit</a>' if link.permission == "write" else ""
    pdf = f'<a class="btn" href="/s/{escape(link.token)}/pdf" download>Download PDF</a>' if link.allow_download and "pdf" in keys else ""
    dl = edit + pdf
    text = f'<section class="text">{link.text_html}</section>' if link.text_html.strip() else ""
    body = (f'<main><header><h1>{escape(link.title or "Untitled")}</h1>{dl}</header>{imgs}{text}'
            f'<p class="brand" style="margin-top:32px">Shared with Inkwell</p></main>')
    return _page(body, title=link.title or "Shared note")


def public_asset(request, token, key):
    if not hit(f"pubview:{client_ip(request)}", settings.PUBLIC_VIEW_RATE * 4, 60):
        return _gone("Too many requests", 429)
    link, bad = _get(token)
    if bad:
        return bad
    if _needs_login(link) or not _authorized(request, link):
        return _gone("Not available", 401)
    a = PublicAsset.objects.filter(link=link, key=key).first()
    f = _public_dir(link) / key
    if not a or not f.is_file() or (key == "pdf" and not link.allow_download):
        raise Http404
    r = FileResponse(open(f, "rb"), content_type=a.mime)
    r["Cache-Control"] = "private, max-age=300"
    r["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    r["X-Robots-Tag"] = "noindex"
    if a.mime == "application/pdf":
        r["Content-Disposition"] = 'attachment; filename="note.pdf"'
    return r


def public_pdf(request, token):
    return public_asset(request, token, "pdf")
