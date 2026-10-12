from django.db.models import Sum

from .models import AssetBlob, Profile, PublicAsset, Record


def used_bytes(user):
    a = AssetBlob.objects.filter(user=user).aggregate(s=Sum("size"))["s"] or 0
    b = PublicAsset.objects.filter(link__owner=user).aggregate(s=Sum("size"))["s"] or 0
    return a + b


def quota_bytes(user):
    return Profile.of(user).quota_bytes()


def note_count(user):
    return Record.objects.filter(user=user, kind="notes", deleted=False).count()
