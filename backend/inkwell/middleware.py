from django.conf import settings
from django.http import HttpResponse


class CorsMiddleware:
    """Tiny CORS implementation (token auth, no cookies, so '*' is safe)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def _allowed(self, origin):
        allowed = settings.CORS_ALLOWED_ORIGINS
        if not origin or not allowed:
            return None
        if "*" in allowed:
            return "*"
        return origin if origin in allowed else None

    def __call__(self, request):
        if not request.path.startswith("/api/"):
            return self.get_response(request)
        allow = self._allowed(request.headers.get("Origin"))
        if request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method"):
            resp = HttpResponse(status=204)
        else:
            resp = self.get_response(request)
        if allow:
            resp["Access-Control-Allow-Origin"] = allow
            resp["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, HEAD, OPTIONS"
            resp["Access-Control-Allow-Headers"] = "Authorization, Content-Type, If-None-Match, X-Device-Id, X-Note-Id"
            resp["Access-Control-Expose-Headers"] = "ETag, X-Server-Time"
            resp["Access-Control-Max-Age"] = "86400"
            resp["Vary"] = "Origin"
        return resp


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resp = self.get_response(request)
        resp.setdefault("X-Content-Type-Options", "nosniff")
        resp.setdefault("Referrer-Policy", "same-origin")
        resp.setdefault("Permissions-Policy", "camera=(), geolocation=(), microphone=(self), payment=()")
        if request.path.startswith("/api/"):
            resp.setdefault("Cache-Control", "no-store")
        elif not request.path.startswith("/admin/"):
            resp.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; "
                "font-src 'self' data:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; "
                f"connect-src {settings.CSP_CONNECT_SRC}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
            )
        return resp
