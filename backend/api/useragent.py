"""Tiny user-agent parser: (browser, os, device kind)."""
import re

_BROWSERS = [("Edge", r"Edg(?:e|A|iOS)?/"), ("Opera", r"OPR/|Opera"), ("Firefox", r"Firefox/|FxiOS/"),
             ("Samsung Internet", r"SamsungBrowser/"), ("Chrome", r"Chrome/|CriOS/"), ("Safari", r"Safari/")]
_OS = [("iOS", r"iPhone|iPad|iPod"), ("Android", r"Android"), ("Windows", r"Windows"), ("macOS", r"Mac OS X|Macintosh"),
       ("ChromeOS", r"CrOS"), ("Linux", r"Linux|X11")]


def parse_ua(ua: str):
    ua = ua or ""
    browser = next((n for n, rx in _BROWSERS if re.search(rx, ua)), "")
    if not browser and re.search(r"python|curl|okhttp|node", ua, re.I):
        browser = "Script"
    os_ = next((n for n, rx in _OS if re.search(rx, ua)), "")
    if re.search(r"iPad|Tablet", ua) or (os_ == "Android" and "Mobile" not in ua):
        kind = "tablet"
    elif re.search(r"iPhone|iPod|Mobile", ua):
        kind = "phone"
    else:
        kind = "desktop" if os_ else ""
    return browser, os_, kind
