import os
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand

from api.models import AssetBlob, Profile, PublicAsset


class Command(BaseCommand):
    help = "Check STATIC_ROOT / MEDIA_ROOT / database paths, free disk space and report orphaned or missing files."

    def add_arguments(self, p):
        p.add_argument("--delete-orphans", action="store_true", help="remove files in MEDIA_ROOT that no database row references")

    def handle(self, *a, **o):
        ok = True
        for label, path in (("STATIC_ROOT", settings.STATIC_ROOT), ("MEDIA_ROOT", settings.MEDIA_ROOT)):
            exists, writable = os.path.isdir(path), os.access(path, os.W_OK)
            ok &= exists and writable
            self.stdout.write(f"{label}: {path} exists={exists} writable={writable}")
        db = settings.DATABASES["default"]
        if db["ENGINE"].endswith("sqlite3"):
            d = os.path.dirname(db["NAME"])
            self.stdout.write(f"database: {db['NAME']} writable_dir={os.access(d, os.W_OK)}")
        free = shutil.disk_usage(settings.MEDIA_ROOT if os.path.isdir(settings.MEDIA_ROOT) else ".").free
        self.stdout.write(f"free disk: {free // 1048576} MB")
        known = {str(b.path) for b in AssetBlob.objects.all()}
        missing = [p for p in known if not os.path.isfile(p)]
        pub = set()
        from api.views_share import _public_dir

        for pa in PublicAsset.objects.select_related("link"):
            f = _public_dir(pa.link) / (pa.fname or pa.key)
            pub.add(str(f))
            if not f.is_file():
                missing.append(str(f))
        avatars = {str(settings.MEDIA_ROOT / "avatars" / p.user.public_id / p.avatar_id) for p in Profile.objects.exclude(avatar_id="").select_related("user")}
        keep = {str(x) for x in known | pub | avatars}
        orphans = []
        for root, _, names in os.walk(settings.MEDIA_ROOT):
            for n in names:
                f = os.path.join(root, n)
                if f not in keep and not n.endswith(".part"):
                    orphans.append(f)
        self.stdout.write(f"files referenced but missing: {len(missing)}")
        for m in missing[:20]:
            self.stdout.write(f"  missing {m}")
        self.stdout.write(f"orphaned files: {len(orphans)} ({sum(os.path.getsize(f) for f in orphans) // 1024} KB)")
        for f in orphans[:20]:
            self.stdout.write(f"  orphan {f}")
        if o["delete_orphans"]:
            for f in orphans:
                os.remove(f)
            self.stdout.write(f"deleted {len(orphans)} orphan(s)")
        self.stdout.write("OK" if ok and not missing else "ATTENTION NEEDED")
