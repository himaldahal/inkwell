from django.http import JsonResponse

from . import access, trash
from .models import Record
from .util import api, err, parse_json


def _own_deleted(user):
    return Record.objects.filter(user=user, deleted=True, kind__in=("notes", "notebooks")).exclude(data="{}")


@api(("GET",))
def trash_list(request):
    return JsonResponse({"items": [trash.trash_json(r) for r in _own_deleted(request.user).order_by("-deleted_at")[:500]]})


@api(("POST",))
def trash_restore(request, kind, rid):
    r = _own_deleted(request.user).filter(kind=kind, record_id=rid).first()
    if not r:
        return err("not found", 404)
    trash.restore(r, access.next_seqs(1))
    return JsonResponse({"ok": True})


@api(("DELETE",))
def trash_purge(request, kind, rid):
    n = trash.purge_qs(_own_deleted(request.user).filter(kind=kind, record_id=rid))
    return JsonResponse({"ok": True, "purged": n})


@api(("POST",))
def trash_empty(request):
    return JsonResponse({"ok": True, "purged": trash.purge_qs(_own_deleted(request.user))})


@api(("POST",))
def trash_delete_many(request):
    """Permanently delete a selection right now (also removes attachment files)."""
    items = (parse_json(request) or {}).get("items") or []
    n = 0
    for it in items[:500]:
        if isinstance(it, dict) and it.get("kind") in ("notes", "notebooks"):
            n += trash.purge_qs(_own_deleted(request.user).filter(kind=it["kind"], record_id=str(it.get("id"))[:64]))
    return JsonResponse({"ok": True, "purged": n})
