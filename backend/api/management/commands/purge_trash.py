from django.core.management.base import BaseCommand

from api import trash


class Command(BaseCommand):
    help = "Wipe the content of records deleted more than TRASH_RETENTION_DAYS ago (optional cron; also runs lazily)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=None)

    def handle(self, *a, **o):
        self.stdout.write(f"purged {trash.purge_expired(o['days'])} record(s)")
