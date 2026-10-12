from django.contrib import admin
from django.urls import include, path, re_path

from api import views_app

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    path("", views_app.index),
    # SPA fallback (hash routing makes this rare); never swallow files or api
    re_path(r"^(?!api/|admin/|django-static/)(?P<path>[^.]*)$", views_app.index),
]
