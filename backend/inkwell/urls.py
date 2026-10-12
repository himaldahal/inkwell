from django.contrib import admin
from django.urls import include, path, re_path

from api import views_app, views_public

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    path("s/<str:token>", views_public.public_view),
    path("s/<str:token>/a/<str:key>", views_public.public_asset),
    path("s/<str:token>/pdf", views_public.public_pdf),
    path("", views_app.index),
    # SPA fallback (hash routing makes this rare); never swallow files or api
    re_path(r"^(?!api/|admin/|django-static/|s/)(?P<path>[^.]*)$", views_app.index),
]
