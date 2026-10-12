"""E-mail composition: text + HTML templates, sent through whatever EMAIL_* backend is configured."""
import logging
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

log = logging.getLogger(__name__)


def origin(request=None):
    if settings.APP_URL:
        return settings.APP_URL
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return ""


def _layout(title, body_html, button=None):
    btn = ""
    if button:
        btn = ('<p style="margin:24px 0"><a href="%s" style="background:#4f46e5;color:#fff;text-decoration:none;'
               'padding:12px 22px;border-radius:10px;display:inline-block;font-weight:600">%s</a></p>'
               '<p style="color:#6b6880;font-size:13px">Or paste this link into your browser:<br>'
               '<span style="word-break:break-all">%s</span></p>') % (escape(button[1], quote=True), escape(button[0]), escape(button[1]))
    return ('<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:system-ui,-apple-system,Segoe UI,sans-serif">'
            '<div style="max-width:520px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border-radius:16px;padding:28px;color:#1f1d2b">'
            '<div style="font-weight:700;font-size:20px;color:#4f46e5;margin-bottom:12px">Inkwell</div>'
            '<h1 style="font-size:20px;margin:0 0 12px">%s</h1>%s%s</div>'
            '<p style="color:#9a98b0;font-size:12px;text-align:center;margin-top:16px">Sent by Inkwell. If you did not expect this e-mail you can ignore it.</p>'
            '</div></body></html>') % (escape(title), body_html, btn)


def send(to, subject, text, title, body_html, button=None):
    if button:
        text = f"{text}\n\n{button[0]}: {button[1]}\n"
    msg = EmailMultiAlternatives(subject, text + "\n-- Inkwell", settings.DEFAULT_FROM_EMAIL, [to])
    msg.attach_alternative(_layout(title, body_html, button), "text/html")
    try:
        msg.send(fail_silently=False)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("e-mail to %s failed: %s", to, e)
        return False


def send_verify(request, user, token, new_email=None):
    link = f"{origin(request)}/#/auth/verify?token={token}"
    to = new_email or user.email
    return send(to, "Confirm your e-mail for Inkwell", f"Hi {user.get_username()},\n\nPlease confirm your e-mail address.",
                "Confirm your e-mail", f"<p>Hi {escape(user.get_username())},</p><p>Please confirm your e-mail address to finish setting up Inkwell. The link is valid for {settings.EMAIL_TOKEN_TTL_HOURS} hours and works once.</p>",
                ("Confirm e-mail", link))


def send_reset(request, user, token):
    link = f"{origin(request)}/#/auth/reset?token={token}"
    return send(user.email, "Reset your Inkwell password", f"Hi {user.get_username()},\n\nSomeone asked to reset your password. If it was you, use the link below.",
                "Reset your password", f"<p>Hi {escape(user.get_username())},</p><p>Someone asked to reset your password. If it was you, choose a new one with the button below. The link expires in {settings.EMAIL_TOKEN_TTL_HOURS} hours and works once.</p>",
                ("Choose a new password", link))


def send_welcome(request, user):
    return send(user.email, "Welcome to Inkwell", f"Welcome, {user.get_username()}! Your account is ready.",
                "Welcome to Inkwell", f"<p>Welcome, {escape(user.get_username())}! Your account is ready. Your notes work offline and sync whenever you are connected.</p>",
                ("Open Inkwell", origin(request) + "/"))


def send_share(request, owner, recipient, title, role):
    link = origin(request) + "/#/shared"
    t = title or "Untitled"
    return send(recipient.email, f"{owner.get_username()} shared \"{t}\" with you",
                f"{owner.get_username()} shared \"{t}\" with you as {role}.",
                "A note was shared with you", f"<p><b>{escape(owner.get_username())}</b> shared <b>{escape(t)}</b> with you ({escape(role)}).</p>",
                ("Open shared notes", link))
