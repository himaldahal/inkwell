from django.contrib import admin

from django.contrib.auth.admin import UserAdmin

from .models import AssetBlob, Device, Record, Token, User

@admin.register(User)
class InkwellUserAdmin(UserAdmin):
    ordering = ("email",)
    list_display = ("email", "display_name", "is_active", "is_staff")
    search_fields = ("email", "display_name")
    fieldsets = ((None, {"fields": ("email", "password")}), ("Profile", {"fields": ("display_name",)}),
                 ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser")}))
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)


admin.site.register(Device)
admin.site.register(AssetBlob)


@admin.register(Record)
class RecordAdmin(admin.ModelAdmin):
    list_display = ("user", "kind", "record_id", "updated_at", "deleted", "seq")
    list_filter = ("kind", "deleted")
    exclude = ("data",)


@admin.register(Token)
class TokenAdmin(admin.ModelAdmin):
    list_display = ("user", "device", "created_at", "last_used", "expires_at")
    exclude = ("key_hash",)

from .models import AuditLog, EmailToken, Plan, Profile, PublicLink, Share  # noqa: E402

admin.site.register(Plan)
admin.site.register(Share)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "plan", "storage_mb_override", "max_notes_override", "email_verified", "must_change_password")
    list_filter = ("plan", "email_verified")


@admin.register(PublicLink)
class PublicLinkAdmin(admin.ModelAdmin):
    list_display = ("owner", "title", "views", "revoked", "expires_at", "updated_at")
    exclude = ("text_html", "password_hash")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "event", "user", "actor", "detail", "ip")
    list_filter = ("event",)
    readonly_fields = [f.name for f in AuditLog._meta.fields]


admin.site.register(EmailToken, admin.ModelAdmin)
