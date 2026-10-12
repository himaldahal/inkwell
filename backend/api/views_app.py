"""Serve the built frontend. WhiteNoise normally serves these first; the view is the
fallback (and what makes `manage.py test` / non-whitenoise setups work)."""
from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse

NO_CACHE = "no-cache, max-age=0, must-revalidate"


def index(request, path=""):
    f = settings.APP_DIR / "index.html"
    if not f.is_file():
        return HttpResponse("Inkwell frontend not built. Run `npm run build`.", status=503, content_type="text/plain")
    r = FileResponse(open(f, "rb"), content_type="text/html; charset=utf-8")
    r["Cache-Control"] = NO_CACHE
    return r


def not_found(request, exception=None):
    from django.http import JsonResponse

    if request.path.startswith("/api/"):
        return JsonResponse({"error": "not found"}, status=404)
    return HttpResponse(
        '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title>'
        '<body style="font:16px system-ui;text-align:center;margin-top:20vh"><h1>Not found</h1><p><a href="/">Back to Inkwell</a></p></body>',
        status=404, content_type="text/html; charset=utf-8")
