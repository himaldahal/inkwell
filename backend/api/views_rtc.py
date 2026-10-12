"""WebRTC signalling over plain HTTP (polling). State lives in the DB with a short TTL."""
import base64
import hashlib
import hmac
import json
import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone

from . import access
from .models import RtcSignal
from .util import api, err, hit, parse_json, public_user

TTL = timedelta(minutes=2)
TYPES = {"hello", "bye", "offer", "answer", "ice"}


def ice_servers(user):
    """P2P is opt-in and TURN-only (iceTransportPolicy=relay) so peers never learn each other's IP.
    Without TURN configured no ICE servers are returned and clients stay on the HTTP relay."""
    servers = []
    if settings.TURN_URL:
        if settings.TURN_SECRET:  # ephemeral credentials (coturn use-auth-secret)
            name = f"{int(time.time()) + 3600}:{user.pk}"
            cred = base64.b64encode(hmac.new(settings.TURN_SECRET.encode(), name.encode(), hashlib.sha1).digest()).decode()
            servers.append({"urls": [settings.TURN_URL], "username": name, "credential": cred})
        elif settings.TURN_USERNAME:
            servers.append({"urls": [settings.TURN_URL], "username": settings.TURN_USERNAME, "credential": settings.TURN_CREDENTIAL})
    return servers


@api(("GET",))
def ice(request):
    return JsonResponse({"iceServers": ice_servers(request.user), "iceTransportPolicy": "relay", "p2p": bool(settings.TURN_URL)})


def _room(request, data):
    from django.contrib.auth import get_user_model

    pid = str(data.get("ownerId") or request.user.public_id)[:32]
    ou = get_user_model().objects.filter(public_id=pid).first()
    if not ou:
        return None
    owner = ou.pk
    note = str(data.get("noteId") or "")[:64]
    if not note or not access.role_for(request.user, owner, "notes", note):
        return None
    return owner, note


@api(("GET", "POST"))
def signal(request):
    """POST {ownerId,noteId,peer,to?,type,payload}; GET ?ownerId=&noteId=&peer=&since= -> messages for me."""
    if request.method == "POST":
        b = parse_json(request) or {}
        room = _room(request, b)
        if not room:
            return err("forbidden", 403)
        if b.get("type") not in TYPES or not b.get("peer"):
            return err("invalid message")
        if not hit(f"rtc:{request.user.pk}", 600, 60, db=False):
            return err("rate limited", 429)
        payload = json.dumps(b.get("payload") or {})
        if len(payload) > 20000:
            return err("payload too large", 413)
        RtcSignal.objects.create(owner_id=room[0], note_id=room[1], from_user=request.user, from_peer=str(b["peer"])[:40],
                                 to_peer=str(b.get("to") or "")[:40], type=b["type"], payload=payload)
        if cache.add("rtc:gc", 1, 60):
            RtcSignal.objects.filter(created_at__lt=timezone.now() - TTL).delete()
        return JsonResponse({"ok": True})
    room = _room(request, request.GET)
    if not room:
        return err("forbidden", 403)
    peer = request.GET.get("peer", "")[:40]
    try:
        since = int(request.GET.get("since", 0))
    except ValueError:
        since = 0
    from django.db.models import Q

    rows = (RtcSignal.objects.filter(owner_id=room[0], note_id=room[1], id__gt=since, created_at__gt=timezone.now() - TTL)
            .exclude(from_peer=peer).filter(Q(to_peer="") | Q(to_peer=peer)).select_related("from_user").order_by("id")[:100])
    msgs = [{"id": r.id, "from": r.from_peer, "type": r.type, "payload": json.loads(r.payload or "{}"),
             "user": public_user(r.from_user)} for r in rows]
    last = RtcSignal.objects.filter(owner_id=room[0], note_id=room[1]).order_by("-id").values_list("id", flat=True).first() or 0
    return JsonResponse({"messages": msgs, "last": max(last, since)})
