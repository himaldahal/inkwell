"""Ownership and sharing rules. Every Record belongs to `user` (the owner); other users reach it only via a Share."""
from django.db import transaction
from django.db.models import F, Q

from .models import Record, SeqCounter, Share

ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}


def _best(roles):
    roles = list(roles)
    if "editor" in roles:
        return "editor"
    return "viewer" if roles else None


def role_for(user, owner_id, kind, rid, parent_id=None):
    """'owner' | 'editor' | 'viewer' | None for a record of `owner_id`."""
    if user.pk == owner_id:
        return "owner"
    if kind == "assets":
        if parent_id is None:
            ex = Record.objects.filter(user_id=owner_id, kind="assets", record_id=rid).first()
            parent_id = ex.parent_id if ex else ""
        return role_for(user, owner_id, "notes", parent_id) if parent_id else None
    q = Q(kind=kind, record_id=rid)
    if kind == "notes":
        if parent_id is None:
            ex = Record.objects.filter(user_id=owner_id, kind="notes", record_id=rid).first()
            parent_id = ex.parent_id if ex else ""
        if parent_id:
            q |= Q(kind="notebooks", record_id=parent_id)
    return _best(Share.objects.filter(owner_id=owner_id, recipient=user).filter(q).values_list("role", flat=True))


def visible_q(user):
    q = Q(user=user)
    for s in Share.objects.filter(recipient=user):
        o = s.owner_id
        if s.kind == "notes":
            q |= Q(user_id=o, kind="notes", record_id=s.record_id) | Q(user_id=o, kind="assets", parent_id=s.record_id)
        elif s.kind == "notebooks":
            ids = list(Record.objects.filter(user_id=o, kind="notes", parent_id=s.record_id).values_list("record_id", flat=True))
            q |= Q(user_id=o, kind="notebooks", record_id=s.record_id) | Q(user_id=o, kind="notes", parent_id=s.record_id)
            if ids:
                q |= Q(user_id=o, kind="assets", parent_id__in=ids)
    return q


def next_seqs(n):
    SeqCounter.objects.get_or_create(pk=1)
    SeqCounter.objects.filter(pk=1).update(value=F("value") + n)
    top = SeqCounter.objects.get(pk=1).value
    return top - n + 1


@transaction.atomic
def bump(owner_id, kind, rid):
    """Give the shared records a fresh seq so recipients with an advanced cursor pull them."""
    qs = Q(kind=kind, record_id=rid)
    if kind == "notes":
        qs |= Q(kind="assets", parent_id=rid)
    else:
        ids = list(Record.objects.filter(user_id=owner_id, kind="notes", parent_id=rid).values_list("record_id", flat=True))
        qs |= Q(kind="notes", parent_id=rid) | Q(kind="assets", parent_id__in=ids)
    rows = list(Record.objects.filter(user_id=owner_id).filter(qs))
    if not rows:
        return
    s = next_seqs(len(rows))
    for i, r in enumerate(rows):
        r.seq = s + i
        r.save(update_fields=["seq"])


def shares_signature(user):
    from django.db.models import Count, Max

    a = Share.objects.filter(recipient=user).aggregate(n=Count("id"), m=Max("id"))
    return f"{a['n']}.{a['m'] or 0}"
