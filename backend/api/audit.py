from .models import AuditLog
from .util import client_ip


def audit(request, event, user=None, detail=""):
    actor = ""
    u = getattr(request, "user", None)
    if u is not None and getattr(u, "is_authenticated", False):
        actor = u.get_username()
    try:
        AuditLog.objects.create(user=user if (user and user.pk) else None, actor=actor or (user.get_username() if user else ""),
                                event=event, detail=str(detail)[:300], ip=client_ip(request)[:45])
    except Exception:  # noqa: BLE001  auditing must never break a request
        pass
