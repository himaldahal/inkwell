from django.contrib import admin

from .models import AssetBlob, Device, Record, Token

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
