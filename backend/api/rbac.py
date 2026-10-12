"""Role based access control. Deny by default: every /api/admin/* and /api/system/* view declares the permission it needs."""
import json

PERMS = {
    "users.read": "View users, devices and sign-in history",
    "users.write": "Create and edit users, reset passwords",
    "users.delete": "Delete users",
    "users.reset_sessions": "Sign users out / send reset e-mails",
    "roles.manage": "Create roles and assign them to users",
    "shares.manage": "Manage shares and public links",
    "abuse.manage": "Abuse center: blocks, lockouts, reports",
    "mail.manage": "Mail queue, suppress list, test e-mail",
    "audit.read": "Read the audit log",
    "analytics.read": "Read analytics and statistics",
    "health.read": "See system health",
    "settings.read": "Read runtime settings",
    "settings.write": "Change runtime settings",
    "trash.purge": "Purge server-side trash",
    "system.read": "Open the system panel (server info, jobs)",
    "data.read": "Browse raw tables in the data viewer",
}
ALL = frozenset(PERMS)
BUILTIN = {
    "superuser": ALL,
    "admin": frozenset({"users.read", "users.write", "users.delete", "users.reset_sessions", "shares.manage", "abuse.manage", "mail.manage",
                        "audit.read", "analytics.read", "health.read", "settings.read", "trash.purge"}),
    "support": frozenset({"users.read", "users.reset_sessions", "audit.read"}),
    "analyst": frozenset({"analytics.read"}),
    "user": frozenset(),
}


def ensure_builtin():
    from .models import Role

    for name, perms in BUILTIN.items():
        r, created = Role.objects.get_or_create(name=name, defaults={"builtin": True, "permissions": json.dumps(sorted(perms))})
        if not created and r.builtin and set(json.loads(r.permissions)) != set(perms):
            r.permissions = json.dumps(sorted(perms))  # built-ins are code-defined and cannot drift
            r.save(update_fields=["permissions"])


def role_of(user):
    """The Role name for a user: superuser flag wins, then the assigned role, then legacy is_staff -> admin."""
    if user.is_superuser:
        return "superuser"
    p = getattr(user, "profile", None)
    if p is not None and p.role_id:
        return p.role.name
    return "admin" if user.is_staff else "user"


def perms_of(user):
    if not user.is_active:
        return frozenset()
    name = role_of(user)
    if name in BUILTIN:
        return BUILTIN[name]
    from .models import Role

    r = Role.objects.filter(name=name).first()
    return frozenset(json.loads(r.permissions)) & ALL if r else frozenset()


def has_perm(user, perm):
    return perm in perms_of(user)
