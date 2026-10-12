import json
import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.utils import timezone

from .models import AuditLog, EmailToken, Plan, Profile, PublicLink, Share
from .sanitize import sanitize_html
from .tests import Base, j, rec

User = get_user_model()
PW = "correct-horse-42"


class Helpers(Base):
    def make_user(self, name, email=None, staff=False, device="d"):
        u = User.objects.create_user(name, email or f"{name}@example.com", PW, is_staff=staff)
        Profile.objects.create(user=u, email_verified=True)
        return u, self.login(name, device=f"{device}-{name}")

    def auth(self, t):
        return {"HTTP_AUTHORIZATION": f"Bearer {t}"}

    def put_bytes(self, path, t, data, ctype):
        return self.c.put(path, data=data, content_type=ctype, **self.auth(t))

    def patch(self, path, body, t):
        return self.c.patch(path, json.dumps(body), content_type="application/json", **self.auth(t))


@override_settings(ALLOW_REGISTRATION=False)
class InternalModeTests(Helpers):
    def test_config_and_no_public_registration(self):
        cfg = j(self.get("/api/config"))
        self.assertEqual(cfg["mode"], "internal")
        self.assertFalse(cfg["registrationOpen"])
        self.assertEqual(self.post("/api/auth/register", {"username": "mallory", "password": PW}).status_code, 403)

    def test_admin_manages_users(self):
        _, admin = self.make_user("root", staff=True)
        _, normal = self.make_user("bob")
        self.assertEqual(self.get("/api/admin/users", normal).status_code, 403)
        r = self.post("/api/admin/users", {"username": "carol", "email": "carol@example.com", "storageMb": 5}, admin)
        self.assertEqual(r.status_code, 201)
        temp = j(r)["tempPassword"]
        uid = j(r)["user"]["id"]
        # temp password works but must be changed before anything else
        t = j(self.post("/api/auth/login", {"username": "carol", "password": temp, "deviceId": "c1"}))
        self.assertTrue(t["mustChangePassword"])
        self.assertEqual(self.get("/api/sync/pull", t["token"]).status_code, 403)
        self.assertEqual(self.get("/api/auth/me", t["token"]).status_code, 200)
        r = self.post("/api/auth/password", {"oldPassword": temp, "newPassword": "my-brand-new-pass-9"}, t["token"])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.get("/api/sync/pull", t["token"]).status_code, 200)
        # reset + deactivate
        r = self.post(f"/api/admin/users/{uid}/reset", {}, admin)
        self.assertEqual(self.get("/api/auth/me", t["token"]).status_code, 401)
        self.assertTrue(j(r)["tempPassword"])
        self.patch(f"/api/admin/users/{uid}", {"isActive": False, "storageMb": 1, "maxNotes": 3}, admin)
        u = User.objects.get(pk=uid)
        self.assertFalse(u.is_active)
        self.assertEqual(u.profile.storage_mb_override, 1)
        self.assertEqual(self.post("/api/auth/login", {"username": "carol", "password": j(r)["tempPassword"]}).status_code, 401)
        users = j(self.get("/api/admin/users", admin))["users"]
        self.assertEqual({x["username"] for x in users}, {"root", "bob", "carol"})
        self.assertEqual(self.patch(f"/api/admin/users/{User.objects.get(username='root').pk}", {"isActive": False}, admin).status_code, 400)
        events = {e["event"] for e in j(self.get("/api/admin/audit", admin))["events"]}
        self.assertTrue({"admin.create_user", "admin.reset_password", "admin.update_user", "login"} <= events)

    def test_note_limit(self):
        u, t = self.make_user("limited")
        Profile.objects.filter(user=u).update(max_notes_override=2)
        r = self.push(t, rec("notes", "a", 1), rec("notes", "b", 1), rec("notes", "c", 1))
        self.assertEqual(len(r["accepted"]), 2)
        self.assertIn("limit", r["rejected"][0]["error"])


@override_settings(DEPLOYMENT_MODE="commercial", ALLOW_REGISTRATION=True, SMTP_ENABLED=True, REQUIRE_EMAIL_VERIFICATION=True,
                   APP_URL="https://notes.example.com")
class CommercialModeTests(Helpers):
    def token_from_mail(self, idx=-1):
        m = re.search(r"token=([\w-]+)", mail.outbox[idx].body)
        return m.group(1)

    def test_config(self):
        cfg = j(self.get("/api/config"))
        self.assertEqual((cfg["mode"], cfg["registrationOpen"], cfg["smtp"], cfg["emailVerification"]), ("commercial", True, True, True))

    def test_register_verify_login(self):
        r = self.post("/api/auth/register", {"username": "dave", "email": "dave@example.com", "password": PW})
        self.assertTrue(j(r)["verificationRequired"])
        self.assertNotIn("token", j(r))
        self.assertIn("https://notes.example.com/#/auth/verify?token=", mail.outbox[0].body)
        self.assertTrue(mail.outbox[0].alternatives)  # HTML part
        self.assertEqual(self.post("/api/auth/login", {"username": "dave", "password": PW}).status_code, 403)
        tok = self.token_from_mail()
        self.assertEqual(self.post("/api/auth/verify", {"token": tok}).status_code, 200)
        self.assertEqual(self.post("/api/auth/verify", {"token": tok}).status_code, 400)  # single use
        self.assertEqual(self.post("/api/auth/login", {"username": "dave", "password": PW, "deviceId": "x"}).status_code, 200)

    def test_register_requires_email(self):
        self.assertEqual(self.post("/api/auth/register", {"username": "erin", "password": PW}).status_code, 400)

    def test_resend_throttled_and_expiry(self):
        self.post("/api/auth/register", {"username": "fay", "email": "fay@example.com", "password": PW})
        n = len(mail.outbox)
        self.post("/api/auth/resend", {"email": "fay@example.com"})
        self.post("/api/auth/resend", {"email": "fay@example.com"})
        self.assertEqual(len(mail.outbox), n + 1)  # second one throttled
        old = self.token_from_mail()
        EmailToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.post("/api/auth/verify", {"token": old}).status_code, 400)

    def test_forgot_reset(self):
        self.make_user("gus", email="gus@example.com")
        mail.outbox.clear()
        for e in ("nobody@example.com", "gus@example.com"):
            self.assertEqual(self.post("/api/auth/forgot", {"email": e}).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("#/auth/reset?token=", mail.outbox[0].body)
        tok = self.token_from_mail()
        self.assertEqual(self.post("/api/auth/reset", {"token": tok, "newPassword": "123"}).status_code, 400)  # weak: link survives
        self.assertEqual(self.post("/api/auth/reset", {"token": tok, "newPassword": "totally-new-pass-55"}).status_code, 200)
        self.assertEqual(self.post("/api/auth/reset", {"token": tok, "newPassword": "totally-new-pass-66"}).status_code, 400)
        self.assertEqual(self.post("/api/auth/login", {"username": "gus", "password": "totally-new-pass-55", "deviceId": "q"}).status_code, 200)

    @override_settings(SMTP_ENABLED=False)
    def test_forgot_unavailable_without_smtp(self):
        self.assertEqual(self.post("/api/auth/forgot", {"email": "a@b.co"}).status_code, 501)

    def test_change_email_and_export(self):
        u, t = self.make_user("hana", email="old@example.com")
        mail.outbox.clear()
        self.assertEqual(self.post("/api/auth/email", {"password": "bad", "newEmail": "new@example.com"}, t).status_code, 403)
        self.assertEqual(self.post("/api/auth/email", {"password": PW, "newEmail": "new@example.com"}, t).status_code, 200)
        self.assertEqual(mail.outbox[0].to, ["new@example.com"])
        self.post("/api/auth/verify", {"token": self.token_from_mail()})
        u.refresh_from_db()
        self.assertEqual(u.email, "new@example.com")
        self.push(t, rec("notes", "n1", 1, title="mine"))
        exp = j(self.get("/api/auth/export", t))
        self.assertEqual(exp["records"][0]["data"]["title"], "mine")

    def test_audit_logged(self):
        self.post("/api/auth/register", {"username": "ivy", "email": "ivy@example.com", "password": PW})
        self.assertTrue(AuditLog.objects.filter(event="register").exists())
        self.post("/api/auth/login", {"username": "ivy", "password": "nope"})
        self.assertTrue(AuditLog.objects.filter(event="login_failed").exists())

    def test_plan_defaults_editable(self):
        u, t = self.make_user("jo")
        p = Plan.default()
        p.storage_mb, p.max_notes = 7, 1
        p.save()
        info = j(self.get("/api/auth/me", t))["usage"]
        self.assertEqual((info["quotaBytes"], info["noteLimit"]), (7 * 1024 * 1024, 1))


class SharingTests(Helpers):
    def setUp(self):
        super().setUp()
        self.owner, self.ot = self.make_user("owner")
        self.bob, self.bt = self.make_user("bob")
        self.eve, self.et = self.make_user("eve")

    def share(self, kind, rid, who, role):
        r = self.post("/api/share/people", {"kind": kind, "id": rid, "email": f"{who}@example.com", "role": role}, self.ot)
        self.assertIn(r.status_code, (200, 201), r.content)
        return j(r)["share"]

    def test_viewer_sees_but_cannot_write(self):
        self.push(self.ot, rec("notes", "n1", 1000, title="plan", notebookId=""), rec("notes", "n2", 1000, title="private"))
        cur = j(self.get("/api/sync/pull?since=0", self.bt))["cursor"]
        self.share("notes", "n1", "bob", "viewer")
        p = j(self.get(f"/api/sync/pull?since={cur}", self.bt))  # old cursor still sees newly shared (seq bumped)
        self.assertEqual([x["id"] for x in p["records"]], ["n1"])
        self.assertEqual(p["records"][0]["owner"], "owner")
        self.assertEqual(p["records"][0]["role"], "viewer")
        self.assertEqual(p["shared"][0]["id"], "n1")
        # viewer write is refused and the server copy comes back as a forced conflict
        w = dict(rec("notes", "n1", 5000, title="hacked"), ownerId=self.owner.pk)
        r = self.push(self.bt, w)
        self.assertEqual(r["accepted"], [])
        self.assertTrue(r["conflicts"][0]["force"])
        mine = {x["id"]: x for x in j(self.get("/api/sync/pull?since=0", self.ot))["records"]}
        self.assertEqual(mine["n1"]["data"]["title"], "plan")
        # unshared note is not writable / visible
        w2 = dict(rec("notes", "n2", 5000, title="x"), ownerId=self.owner.pk)
        self.assertEqual(self.push(self.bt, w2)["rejected"][0]["error"], "forbidden")

    def test_editor_edits_sync_back_with_lww(self):
        self.push(self.ot, rec("notes", "n1", 1000, title="v1"))
        self.share("notes", "n1", "bob", "editor")
        w = dict(rec("notes", "n1", 3000, title="v2 by bob"), ownerId=self.owner.pk)
        self.assertEqual(len(self.push(self.bt, w)["accepted"]), 1)
        self.assertEqual(j(self.get("/api/sync/pull?since=0", self.ot))["records"][0]["data"]["title"], "v2 by bob")
        old = dict(rec("notes", "n1", 2000, title="stale"), ownerId=self.owner.pk)
        self.assertEqual(len(self.push(self.bt, old)["conflicts"]), 1)

    def test_notebook_share_covers_notes_and_assets(self):
        self.push(self.ot, rec("notebooks", "nb", 1, name="Team"), rec("notes", "n1", 1, title="in", notebookId="nb"),
                  rec("notes", "n9", 1, title="out", notebookId="other"), rec("assets", "as1", 1, noteId="n1"))
        self.put_bytes("/api/assets/as1", self.ot, b"IMG", "image/png")
        self.share("notebooks", "nb", "bob", "editor")
        ids = {x["id"] for x in j(self.get("/api/sync/pull?since=0", self.bt))["records"]}
        self.assertEqual(ids, {"nb", "n1", "as1"})
        self.assertEqual(self.get(f"/api/assets/as1?owner={self.owner.pk}", self.bt).status_code, 200)
        self.assertEqual(self.get(f"/api/assets/as1?owner={self.owner.pk}", self.et).status_code, 404)
        # editor can create a new note inside the shared notebook
        new = dict(rec("notes", "n10", 4000, title="new", notebookId="nb"), ownerId=self.owner.pk)
        self.assertEqual(len(self.push(self.bt, new)["accepted"]), 1)
        self.assertIn("n10", {x["id"] for x in j(self.get("/api/sync/pull?since=0", self.ot))["records"]})
        # editor may upload an attachment for it
        r = self.c.put(f"/api/assets/as2?owner={self.owner.pk}", data=b"x", content_type="image/png", HTTP_X_NOTE_ID="n10", **self.auth(self.bt))
        self.assertEqual(r.status_code, 200)

    def test_revoke_and_outsider_isolation(self):
        self.push(self.ot, rec("notes", "n1", 1, title="s"))
        s = self.share("notes", "n1", "bob", "viewer")
        self.assertEqual(j(self.get("/api/shared", self.bt))["shared"][0]["title"], "s")
        self.assertEqual(j(self.get("/api/sync/pull?since=0", self.et))["records"], [])
        self.assertEqual(self.c.delete(f"/api/share/people/{s['id']}", **self.auth(self.et)).status_code, 404)
        people = j(self.get("/api/share/people?kind=notes&id=n1", self.ot))["people"]
        self.assertEqual(people[0]["recipient"]["username"], "bob")
        self.assertEqual(self.get("/api/share/people?kind=notes&id=n1", self.bt).status_code, 200)
        self.assertEqual(j(self.get("/api/share/people?kind=notes&id=n1", self.bt))["people"], [])  # not the owner's list
        self.assertEqual(self.c.delete(f"/api/share/people/{s['id']}", **self.auth(self.ot)).status_code, 200)
        p = j(self.get("/api/sync/pull?since=0", self.bt))
        self.assertEqual((p["records"], p["shared"]), ([], []))

    def test_share_errors(self):
        self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "missing", "email": "bob@example.com"}, self.ot).status_code, 409)
        self.push(self.ot, rec("notes", "n1", 1))
        self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "ghost@example.com"}, self.ot).status_code, 404)
        self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "owner@example.com"}, self.ot).status_code, 400)
        # a recipient cannot re-share
        self.share("notes", "n1", "bob", "editor")
        self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "eve@example.com"}, self.bt).status_code, 409)
        self.assertEqual(Share.objects.count(), 1)

    @override_settings(SMTP_ENABLED=True)
    def test_share_sends_notification(self):
        self.push(self.ot, rec("notes", "n1", 1, title="Hello"))
        self.share("notes", "n1", "bob", "viewer")
        self.assertEqual(mail.outbox[-1].to, ["bob@example.com"])
        self.assertIn("Hello", mail.outbox[-1].subject)


class PublicLinkTests(Helpers):
    def setUp(self):
        super().setUp()
        self.owner, self.ot = self.make_user("owner")

    def publish(self, **kw):
        body = {"noteId": "n1", "snapshot": {"title": "My <b>note</b>", "text": "<p>hi</p><script>alert(1)</script>", "pages": [{"key": "p1", "w": 820, "h": 1160}]}}
        body.update(kw)
        r = self.post("/api/share/public", body, self.ot)
        self.assertIn(r.status_code, (200, 201), r.content)
        return j(r)["link"]

    def test_publish_view_assets_counter(self):
        link = self.publish(allowDownload=True)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"\x89PNG", "image/png").status_code, 200)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/pdf", self.ot, b"%PDF", "application/pdf").status_code, 200)
        r = self.c.get(link["path"])
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("noindex", html)
        self.assertIn("&lt;b&gt;note&lt;/b&gt;", html)  # title escaped
        self.assertNotIn("<script", html)
        self.assertIn(f"/s/{link['token']}/a/p1", html)
        self.assertIn("Download PDF", html)
        self.assertIn("default-src 'none'", r["Content-Security-Policy"])
        self.assertEqual(b"".join(self.c.get(f"{link['path']}/a/p1").streaming_content), b"\x89PNG")
        self.assertEqual(b"".join(self.c.get(f"{link['path']}/pdf").streaming_content), b"%PDF")
        self.assertEqual(self.get("/api/share/public?noteId=n1", self.ot).status_code, 200)
        self.assertGreaterEqual(j(self.get("/api/share/public?noteId=n1", self.ot))["link"]["views"], 1)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"x", "text/html").status_code, 415)

    def test_download_toggle(self):
        link = self.publish(allowDownload=False)
        self.put_bytes(f"/api/share/public/{link['token']}/asset/pdf", self.ot, b"%PDF", "application/pdf")
        self.assertEqual(self.c.get(f"{link['path']}/pdf").status_code, 404)
        self.assertNotIn("Download PDF", self.c.get(link["path"]).content.decode())

    def test_only_owner_uploads(self):
        link = self.publish()
        _, bt = self.make_user("bob")
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", bt, b"x", "image/png").status_code, 404)

    def test_password_protection(self):
        link = self.publish(password="s3cret-pass")
        self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"IMG", "image/png")
        r = self.c.get(link["path"])
        self.assertIn("Protected note", r.content.decode())
        self.assertNotIn("My", r.content.decode())
        self.assertEqual(self.c.get(f"{link['path']}/a/p1").status_code, 401)
        self.assertEqual(self.c.post(link["path"], {"password": "wrong"}).status_code, 401)
        ok = self.c.post(link["path"], {"password": "s3cret-pass"})
        self.assertEqual(ok.status_code, 200)
        self.assertIn("note", ok.content.decode())
        self.assertEqual(self.c.get(link["path"]).status_code, 200)  # cookie remembered
        self.assertEqual(b"".join(self.c.get(f"{link['path']}/a/p1").streaming_content), b"IMG")
        # fresh client without cookie still blocked
        from django.test import Client

        self.assertEqual(Client().get(f"{link['path']}/a/p1").status_code, 401)

    @override_settings(PUBLIC_PASSWORD_ATTEMPTS=3)
    def test_password_bruteforce_limited(self):
        link = self.publish(password="s3cret-pass")
        codes = [self.c.post(link["path"], {"password": f"x{i}"}).status_code for i in range(6)]
        self.assertIn(429, codes)

    def test_expiry_and_revoke_and_regenerate(self):
        link = self.publish(expiresAt=int((timezone.now() + timedelta(hours=1)).timestamp() * 1000))
        self.assertEqual(self.c.get(link["path"]).status_code, 200)
        PublicLink.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.c.get(link["path"]).status_code, 410)
        # re-publish with new expiry brings it back (live update)
        link2 = self.publish(expiresAt=None)
        self.assertEqual(link2["token"], link["token"])
        self.assertEqual(self.c.get(link["path"]).status_code, 200)
        self.assertEqual(self.c.delete("/api/share/public?noteId=n1", **self.auth(self.ot)).status_code, 200)
        self.assertEqual(self.c.get(link["path"]).status_code, 404)
        link3 = self.publish()
        self.assertNotEqual(link3["token"], link["token"])  # revoked links never come back under the old url
        self.assertEqual(self.c.get(link["path"]).status_code, 404)
        link4 = self.publish(regenerate=True)
        self.assertNotEqual(link4["token"], link3["token"])
        self.assertEqual(self.c.get(link3["path"]).status_code, 404)

    def test_live_update_replaces_content(self):
        link = self.publish()
        self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"old", "image/png")
        self.publish(snapshot={"title": "v2", "text": "<p>second</p>", "pages": [{"key": "q1", "w": 1, "h": 1}]})
        self.assertEqual(self.c.get(f"{link['path']}/a/p1").status_code, 404)
        self.assertIn("second", self.c.get(link["path"]).content.decode())

    def test_unknown_token_and_noindex(self):
        r = self.c.get("/s/doesnotexist")
        self.assertEqual(r.status_code, 404)
        self.assertIn("noindex", r["X-Robots-Tag"])

    @override_settings(PUBLIC_VIEW_RATE=3)
    def test_view_rate_limit(self):
        link = self.publish()
        codes = [self.c.get(link["path"]).status_code for _ in range(6)]
        self.assertIn(429, codes)

    def test_quota_applies_to_public_assets(self):
        link = self.publish()
        Profile.objects.filter(user=self.owner).update(storage_mb_override=1)
        r = self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"x" * (2 * 1024 * 1024), "image/png")
        self.assertEqual(r.status_code, 413)

    def test_requires_auth(self):
        self.assertEqual(self.post("/api/share/public", {"noteId": "n", "snapshot": {}}).status_code, 401)


class SanitizerTests(Base):
    def test_strips_dangerous(self):
        cases = {
            '<p onclick="x()">a</p>': "<p>a</p>",
            "<script>alert(1)</script>ok": "ok",
            "<style>body{}</style>ok": "ok",
            '<a href="javascript:alert(1)">x</a>': "<a>x</a>",
            '<img src=x onerror=alert(1)>': "",
            "<iframe src='//evil'></iframe>t": "t",
            "<b>unclosed": "<b>unclosed</b>",
            "a < b & c": "a &lt; b &amp; c",
            '<svg><script>1</script></svg>after': "after",
            "<form action=//e><input name=x></form>q": "q",
        }
        for src, want in cases.items():
            self.assertEqual(sanitize_html(src), want, src)

    def test_keeps_safe(self):
        out = sanitize_html('<h1>T</h1><ul><li>a</li></ul><a href="https://x.org/?a=1&b=2">l</a><input type="checkbox" checked>')
        self.assertIn("<h1>T</h1>", out)
        self.assertIn('href="https://x.org/?a=1&amp;b=2"', out)
        self.assertIn('rel="noopener noreferrer nofollow"', out)
        self.assertIn("disabled checked", out)
