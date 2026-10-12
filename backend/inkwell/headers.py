"""WhiteNoise header hook: cache policy for the built frontend."""
NO_CACHE = {"sw.js", "index.html", "registerSW.js", "manifest.webmanifest", "offline.html"}


def add_headers(headers, path, url):
    name = url.rsplit("/", 1)[-1] or "index.html"
    if name in NO_CACHE or url in ("/", ""):
        headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
    if name == "sw.js" or name.startswith("workbox-"):
        headers["Service-Worker-Allowed"] = "/"
        headers["Content-Type"] = "text/javascript; charset=utf-8"
        if name == "sw.js":
            headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
    if name.endswith(".webmanifest"):
        headers["Content-Type"] = "application/manifest+json"
    if name.endswith(".wasm"):
        headers["Content-Type"] = "application/wasm"
    if name.endswith((".mjs",)):
        headers["Content-Type"] = "text/javascript; charset=utf-8"
