from django.urls import path

from . import views_assets, views_auth, views_sync

urlpatterns = [
    path("health", views_sync.health),
    path("auth/register", views_auth.register),
    path("auth/login", views_auth.login),
    path("auth/logout", views_auth.logout),
    path("auth/refresh", views_auth.refresh),
    path("auth/me", views_auth.me),
    path("auth/password", views_auth.change_password),
    path("auth/delete", views_auth.delete_account),
    path("devices", views_auth.devices),
    path("devices/<str:device_id>", views_auth.device_detail),
    path("sync/pull", views_sync.pull),
    path("sync/push", views_sync.push),
    path("assets", views_assets.asset_list),
    path("assets/<str:asset_id>", views_assets.asset),
]
