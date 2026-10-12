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
