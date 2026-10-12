from django.urls import path, re_path

from api import views_app, views_public

handler404 = "api.views_app.not_found"

# Pages served by the single-page app (the client maps them to its hash routes). There is no Django admin.
SPA_PATHS = ["dashboard/", "dashboard/system/", "profile/", "login/", "register/"]

urlpatterns = [
    path("api/", __import__("django.urls", fromlist=["include"]).include("api.urls")),
    path("s/<str:token>", views_public.public_view),
    path("s/<str:token>/a/<str:key>", views_public.public_asset),
    path("s/<str:token>/pdf", views_public.public_pdf),
    path("", views_app.index),
    *[path(p, views_app.index) for p in SPA_PATHS],
    re_path(r"^(?:admin|media)(?:/.*)?$", views_app.not_found),  # no Django admin; user media is never served by URL
    # SPA fallback (hash routing makes this rare); never swallow files or api
    re_path(r"^(?!api/|admin|media|static/|s/)(?P<path>[^.]*)$", views_app.index),
]
