"""WSGI entry point for cPanel "Setup Python App" / Phusion Passenger.

Passenger imports the `application` callable from this file. The project
directory is added to sys.path so `inkwell` and `api` are importable no
matter where the app is mounted.
"""
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
if BASE not in sys.path:
    sys.path.insert(0, BASE)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "inkwell.settings")

from inkwell.wsgi import application  # noqa: E402,F401
