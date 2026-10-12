"""Light request metrics: hourly counters and a latency histogram per endpoint (DB, no external services)."""
import time

from django.db.models import F

BUCKETS = (("b10", 10), ("b50", 50), ("b100", 100), ("b250", 250), ("b500", 500), ("b1000", 1000))


def _row(endpoint):
    from .models import ApiStat

    hour = int(time.time() // 3600)
    ApiStat.objects.get_or_create(hour=hour, endpoint=endpoint[:80])
    return ApiStat.objects.filter(hour=hour, endpoint=endpoint[:80])


def record(endpoint, status, ms):
    col = next((c for c, lim in BUCKETS if ms < lim), "bmore")
    upd = {"count": F("count") + 1, "ms_sum": F("ms_sum") + int(ms), col: F(col) + 1}
    if status >= 500:
        upd["errors"] = F("errors") + 1
    elif status in (401, 403, 429):
        upd["denied"] = F("denied") + 1
    _row(endpoint).update(**upd)


def bump(name, n=1):
    """Counter for domain events, e.g. metric:conflicts."""
    try:
        _row("metric:" + name).update(count=F("count") + n)
    except Exception:  # noqa: BLE001
        pass


class MetricsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith("/api/"):
            return self.get_response(request)
        t0 = time.perf_counter()
        resp = self.get_response(request)
        try:
            m = getattr(request, "resolver_match", None)
            record((m.route if m else request.path)[:80], resp.status_code, (time.perf_counter() - t0) * 1000)
        except Exception:  # noqa: BLE001  metrics must never break a request
            pass
        return resp
