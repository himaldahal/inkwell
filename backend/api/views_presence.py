"""Presence (who is here) and per-note activity feed. Collaborators only; payloads carry name/avatar, never e-mail or IP."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import signing
from django.http import JsonResponse
from django.utils import timezone

from . import access, validate
from .models import ActivityEvent, Presence
from .util import api, err, hit, parse_json, public_user

TTL = timedelta(seconds=15)
STATES = {"viewing", "editing", "drawing", "typing"}
ACTIONS = {"created", "edited-page", "added-strokes", "erased", "typed", "added-image", "renamed", "shared", "permissions-changed", "restored"}
COALESCE = timedelta(seconds=30)


def _room(request, data):
    ou = get_user_model().objects.filter(public_id=str(data.get("ownerId") or request.user.public_id)[:32]).first()
    note = str(data.get("noteId") or "")
    if not ou or not validate.ID_RE.match(note) or not access.role_for(request.user, ou.pk, "notes", note):
        return None
    return ou, note


def _list(owner, note, me):
    rows = Presence.objects.filter(owner_id=owner.pk, note_id=note, updated_at__gt=timezone.now() - TTL).exclude(user=me).select_related("user")
    return [{**public_user(r.user), "state": r.state, "pageId": r.page_id} for r in rows]


@api(("GET", "POST"))
def presence(request):
    if request.method == "POST":
        b = parse_json(request) or {}
        room = _room(request, b)
        if not room:
            return err("not found", 404)
        if not hit(f"presence:{request.user.pk}", 120, 60, db=False):
            return err("rate limited", 429)
        st = b.get("state") if b.get("state") in STATES else "viewing"
        Presence.objects.update_or_create(user=request.user, owner_id=room[0].pk, note_id=room[1],
                                          defaults={"state": st, "page_id": str(b.get("pageId") or "")[:64], "updated_at": timezone.now()})
        return JsonResponse({"users": _list(room[0], room[1], request.user)})
    room = _room(request, request.GET)
    if not room:
        return err("not found", 404)
    return JsonResponse({"users": _list(room[0], room[1], request.user)})


@api(("GET", "POST"))
def activity(request, note_id):
    data = request.GET if request.method == "GET" else (parse_json(request) or {})
    room = _room(request, {**dict(data), "noteId": note_id} if request.method == "POST" else {"ownerId": request.GET.get("ownerId"), "noteId": note_id})
    if not room:
        return err("not found", 404)
    owner = room[0]
    if request.method == "POST":
        action = data.get("action")
        if action not in ACTIONS or not hit(f"activity:{request.user.pk}", 300, 60, db=False):
            return err("invalid", 400)
        page, n = str(data.get("pageId") or "")[:64], max(1, min(int(data.get("count") or 1), 100000))
        now = timezone.now()
        last = ActivityEvent.objects.filter(owner_id=owner.pk, note_id=note_id, actor=request.user).order_by("-id").first()
        if last and last.action == action and last.page_id == page and now - last.updated_at < COALESCE:
            last.count += n
            last.updated_at = now
            last.save(update_fields=["count", "updated_at"])
        else:
            ActivityEvent.objects.create(owner_id=owner.pk, note_id=note_id, actor=request.user, action=action, page_id=page, count=n)
        return JsonResponse({"ok": True})
    try:
        before = int(signing.loads(request.GET["before"], salt="activity")) if request.GET.get("before") else None
    except (signing.BadSignature, ValueError):
        return err("bad cursor", 400)
    qs = ActivityEvent.objects.filter(owner_id=owner.pk, note_id=note_id).select_related("actor").order_by("-id")
    if before:
        qs = qs.filter(id__lt=before)
    rows = list(qs[:51])
    more = len(rows) > 50
    rows = rows[:50]
    return JsonResponse({
        "events": [{"actor": public_user(r.actor) if r.actor else None, "action": r.action, "pageId": r.page_id, "count": r.count,
                    "at": int(r.updated_at.timestamp() * 1000)} for r in rows],
        "next": signing.dumps(rows[-1].id, salt="activity", compress=False) if more else None})
