from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from api.models import Profile


class Command(BaseCommand):
    help = "Create (or update) an administrator. Password validators are intentionally NOT applied here."

    def add_arguments(self, p):
        p.add_argument("--email", required=True)
        p.add_argument("--password", required=True)
        p.add_argument("--name", default="")

    def handle(self, *a, **o):
        User = get_user_model()
        email = o["email"].strip().lower()
        if not email or not o["password"]:
            raise CommandError("email and password are required")
        u, created = User.objects.get_or_create(email=email, defaults={"display_name": o["name"]})
        u.is_staff = u.is_superuser = u.is_active = True
        u.set_password(o["password"])
        u.save()
        Profile.objects.update_or_create(user=u, defaults={"email_verified": True})
        self.stdout.write(f"{'created' if created else 'updated'} administrator {email}")
