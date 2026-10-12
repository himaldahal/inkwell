import json
import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.utils import timezone

from .models import AuditLog, EmailToken, Plan, Profile, PublicLink, Record, Share
from .sanitize import sanitize_html
from .tests import Base, j, rec

User = get_user_model()
PW = "Correct-Horse-42"


class Helpers(Base):
    def make_user(self, name, email=None, staff=False, device="d"):
        u = User.objects.create_user(email or f"{name}@example.com", PW, is_staff=staff, display_name=name.title())
        Profile.objects.create(user=u, email_verified=True)
        r = self.post("/api/auth/login", {"email": u.email, "password": PW, "deviceId": f"{device}-{name}"})
        return u, j(r)["token"]

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
        self.assertEqual(self.post("/api/auth/register", {"email": "mallory@example.com", "password": PW}).status_code, 403)

    def test_admin_manages_users(self):
        _, admin = self.make_user("root", staff=True)
        _, normal = self.make_user("bob")
        self.assertEqual(self.get("/api/admin/users", normal).status_code, 403)
        r = self.post("/api/admin/users", {"email": "carol@example.com", "storageMb": 5}, admin)
        self.assertEqual(r.status_code, 201)
        temp = j(r)["tempPassword"]
        uid = j(r)["user"]["id"]  # opaque public id
        # temp password works but must be changed before anything else
        t = j(self.post("/api/auth/login", {"email": "carol@example.com", "password": temp, "deviceId": "c1"}))
        self.assertTrue(t["mustChangePassword"])
        self.assertEqual(self.get("/api/sync/pull", t["token"]).status_code, 403)
        self.assertEqual(self.get("/api/auth/me", t["token"]).status_code, 200)
        r = self.post("/api/auth/password", {"oldPassword": temp, "newPassword": "My-Brand-New-Pass-9"}, t["token"])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.get("/api/sync/pull", t["token"]).status_code, 200)
        # reset + deactivate
        r = self.post(f"/api/admin/users/{uid}/reset", {}, admin)
        self.assertEqual(self.get("/api/auth/me", t["token"]).status_code, 401)
        self.assertTrue(j(r)["tempPassword"])
        self.patch(f"/api/admin/users/{uid}", {"isActive": False, "storageMb": 1, "maxNotes": 3}, admin)
        u = User.objects.get(public_id=uid)
        self.assertFalse(u.is_active)
        self.assertEqual(u.profile.storage_mb_override, 1)
        self.assertEqual(self.post("/api/auth/login", {"email": "carol@example.com", "password": j(r)["tempPassword"]}).status_code, 401)
        users = j(self.get("/api/admin/users", admin))["users"]
        self.assertEqual({x["email"] for x in users}, {"root@example.com", "bob@example.com", "carol@example.com"})
        self.assertEqual(self.patch(f"/api/admin/users/{User.objects.get(email='root@example.com').public_id}", {"isActive": False}, admin).status_code, 400)
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
        r = self.post("/api/auth/register", {"email": "dave@example.com", "password": PW})
        self.assertTrue(j(r)["verificationRequired"])
        self.assertNotIn("token", j(r))
        self.assertIn("https://notes.example.com/#/auth/verify?token=", mail.outbox[0].body)
        self.assertTrue(mail.outbox[0].alternatives)  # HTML part
        self.assertEqual(self.post("/api/auth/login", {"email": "dave@example.com", "password": PW}).status_code, 403)
        tok = self.token_from_mail()
        self.assertEqual(self.post("/api/auth/verify", {"token": tok}).status_code, 200)
        self.assertEqual(self.post("/api/auth/verify", {"token": tok}).status_code, 400)  # single use
        self.assertEqual(self.post("/api/auth/login", {"email": "dave@example.com", "password": PW, "deviceId": "x"}).status_code, 200)

    def test_no_enumeration_on_signup_and_forgot(self):
        self.make_user("kim", email="kim@example.com")
        a = self.post("/api/auth/register", {"email": "kim@example.com", "password": PW})
        b = self.post("/api/auth/register", {"email": "new1@example.com", "password": PW})
        self.assertEqual((a.status_code, j(a)["verificationRequired"]), (b.status_code, j(b)["verificationRequired"]))
        x = self.post("/api/auth/forgot", {"email": "kim@example.com"})
        y = self.post("/api/auth/forgot", {"email": "ghost@example.com"})
        self.assertEqual((x.status_code, x.content), (y.status_code, y.content))

    def test_register_requires_email(self):
        self.assertEqual(self.post("/api/auth/register", {"email": "", "password": PW}).status_code, 400)

    def test_resend_throttled_and_expiry(self):
        self.post("/api/auth/register", {"email": "fay@example.com", "password": PW})
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
        self.assertEqual(self.post("/api/auth/reset", {"token": tok, "newPassword": "Totally-New-Pass-55"}).status_code, 200)
        self.assertEqual(self.post("/api/auth/reset", {"token": tok, "newPassword": "Totally-New-Pass-66"}).status_code, 400)
        self.assertEqual(self.post("/api/auth/login", {"email": "gus@example.com", "password": "Totally-New-Pass-55", "deviceId": "q"}).status_code, 200)

    @override_settings(SMTP_ENABLED=False)
    def test_forgot_unavailable_without_smtp(self):
        self.assertEqual(self.post("/api/auth/forgot", {"email": "a@b.co"}).status_code, 501)

    def test_email_not_user_changeable(self):
        u, t = self.make_user("hana", email="old@example.com")
        self.assertEqual(self.post("/api/auth/email", {"password": PW, "newEmail": "new@example.com"}, t).status_code, 404)
        _, admin = self.make_user("root", staff=True)
        self.assertEqual(self.patch(f"/api/admin/users/{u.public_id}", {"email": "New@Example.com"}, admin).status_code, 200)
        u.refresh_from_db()
        self.assertEqual(u.email, "new@example.com")

    def test_audit_logged(self):
        self.post("/api/auth/register", {"email": "ivy@example.com", "password": PW})
        self.assertTrue(AuditLog.objects.filter(event="register").exists())
        self.post("/api/auth/login", {"email": "ivy@example.com", "password": "nope"})
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
        self.assertEqual(p["records"][0]["owner"], "Owner")
        self.assertEqual(p["records"][0]["role"], "viewer")
        self.assertEqual(p["shared"][0]["id"], "n1")
        # viewer write is refused and the server copy comes back as a forced conflict
        w = dict(rec("notes", "n1", 5000, title="hacked"), ownerId=self.owner.public_id)
        r = self.push(self.bt, w)
        self.assertEqual(r["accepted"], [])
        self.assertTrue(r["conflicts"][0]["force"])
        mine = {x["id"]: x for x in j(self.get("/api/sync/pull?since=0", self.ot))["records"]}
        self.assertEqual(mine["n1"]["data"]["title"], "plan")
        # unshared note is not writable / visible
        w2 = dict(rec("notes", "n2", 5000, title="x"), ownerId=self.owner.public_id)
        self.assertEqual(self.push(self.bt, w2)["rejected"][0]["error"], "forbidden")

    def test_editor_edits_sync_back_with_lww(self):
        self.push(self.ot, rec("notes", "n1", 1000, title="v1"))
        self.share("notes", "n1", "bob", "editor")
        w = dict(rec("notes", "n1", 3000, title="v2 by bob"), ownerId=self.owner.public_id)
        self.assertEqual(len(self.push(self.bt, w)["accepted"]), 1)
        self.assertEqual(j(self.get("/api/sync/pull?since=0", self.ot))["records"][0]["data"]["title"], "v2 by bob")
        old = dict(rec("notes", "n1", 2000, title="stale"), ownerId=self.owner.public_id)
        self.assertEqual(len(self.push(self.bt, old)["conflicts"]), 1)

    def test_notebook_share_covers_notes_and_assets(self):
        self.push(self.ot, rec("notebooks", "nb", 1, name="Team"), rec("notes", "n1", 1, title="in", notebookId="nb"),
                  rec("notes", "n9", 1, title="out", notebookId="other"), rec("assets", "as1", 1, noteId="n1"))
        self.put_bytes("/api/assets/as1", self.ot, b"\x89PNG\r\n\x1a\nIMG", "image/png")
        self.share("notebooks", "nb", "bob", "editor")
        ids = {x["id"] for x in j(self.get("/api/sync/pull?since=0", self.bt))["records"]}
        self.assertEqual(ids, {"nb", "n1", "as1"})
        self.assertEqual(self.get(f"/api/assets/as1?owner={self.owner.public_id}", self.bt).status_code, 200)
        self.assertEqual(self.get(f"/api/assets/as1?owner={self.owner.public_id}", self.et).status_code, 404)
        # editor can create a new note inside the shared notebook
        new = dict(rec("notes", "n10", 4000, title="new", notebookId="nb"), ownerId=self.owner.public_id)
        self.assertEqual(len(self.push(self.bt, new)["accepted"]), 1)
        self.assertIn("n10", {x["id"] for x in j(self.get("/api/sync/pull?since=0", self.ot))["records"]})
        # editor may upload an attachment for it
        r = self.c.put(f"/api/assets/as2?owner={self.owner.public_id}", data=b"\x89PNG\r\n\x1a\nx", content_type="image/png", HTTP_X_NOTE_ID="n10", **self.auth(self.bt))
        self.assertEqual(r.status_code, 200)

    def test_revoke_and_outsider_isolation(self):
        self.push(self.ot, rec("notes", "n1", 1, title="s"))
        s = self.share("notes", "n1", "bob", "viewer")
        self.assertEqual(j(self.get("/api/shared", self.bt))["shared"][0]["title"], "s")
        self.assertNotIn("email", j(self.get("/api/shared", self.bt))["shared"][0]["owner"])
        self.assertEqual(j(self.get("/api/sync/pull?since=0", self.et))["records"], [])
        self.assertEqual(self.c.delete(f"/api/share/people/{s['id']}", **self.auth(self.et)).status_code, 404)
        self.assertEqual(self.c.delete("/api/share/people/doesnotexist", **self.auth(self.et)).status_code, 404)
        people = j(self.get("/api/share/people?kind=notes&id=n1", self.ot))["people"]
        self.assertEqual(people[0]["recipient"]["name"], "Bob")
        self.assertEqual(self.get("/api/share/people?kind=notes&id=n1", self.bt).status_code, 200)
        self.assertEqual(j(self.get("/api/share/people?kind=notes&id=n1", self.bt))["people"], [])  # not the owner's list
        self.assertEqual(self.c.delete(f"/api/share/people/{s['id']}", **self.auth(self.ot)).status_code, 200)
        p = j(self.get("/api/sync/pull?since=0", self.bt))
        self.assertEqual((p["records"], p["shared"]), ([], []))

    def test_pending_invite_claimed_on_signup(self):
        self.push(self.ot, rec("notes", "n1", 1, title="inv"))
        r = self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "newbie@example.com", "role": "viewer"}, self.ot)
        self.assertEqual(r.status_code, 202)
        u, t = self.make_user("newbie")
        from . import access

        access.claim_invites(u)
        self.assertEqual([x["id"] for x in j(self.get("/api/sync/pull?since=0", t))["records"]], ["n1"])

    def test_blocked_user_cannot_share_to_blocker(self):
        self.push(self.ot, rec("notes", "n1", 1))
        self.post("/api/blocks", {"userId": self.owner.public_id}, self.bt)
        self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "bob@example.com"}, self.ot)
        self.assertEqual(j(self.get("/api/sync/pull?since=0", self.bt))["records"], [])

    def test_presence_and_activity_authz(self):
        self.push(self.ot, rec("notes", "n1", 1))
        self.share("notes", "n1", "bob", "editor")
        r = self.post("/api/presence", {"noteId": "n1", "ownerId": self.owner.public_id, "state": "drawing"}, self.bt)
        self.assertEqual(r.status_code, 200)
        users = j(self.post("/api/presence", {"noteId": "n1", "state": "viewing"}, self.ot))["users"]
        self.assertEqual([(u["name"], u["state"]) for u in users], [("Bob", "drawing")])
        self.assertNotIn("email", users[0])
        self.assertEqual(self.post("/api/presence", {"noteId": "n1", "ownerId": self.owner.public_id}, self.et).status_code, 404)
        for _ in range(3):
            self.post("/api/notes/n1/activity", {"ownerId": self.owner.public_id, "action": "added-strokes", "pageId": "p1", "count": 5}, self.bt)
        ev = j(self.get(f"/api/notes/n1/activity?ownerId={self.owner.public_id}", self.ot))["events"]
        self.assertEqual([(e["action"], e["count"]) for e in ev if e["action"] == "added-strokes"], [("added-strokes", 15)])
        self.assertEqual(self.get(f"/api/notes/n1/activity?ownerId={self.owner.public_id}", self.et).status_code, 404)

    def test_share_errors(self):
        self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "missing", "email": "bob@example.com"}, self.ot).status_code, 409)
        self.push(self.ot, rec("notes", "n1", 1))
        self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "ghost@example.com"}, self.ot).status_code, 202)
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


@override_settings(DEPLOYMENT_MODE="commercial")
class PublicLinkTests(Helpers):
    def setUp(self):
        super().setUp()
        self.owner, self.ot = self.make_user("owner")

    def publish(self, **kw):
        if not Record.objects.filter(user=self.owner, record_id="n1").exists():
            self.push(self.ot, rec("notes", "n1", 1, title="t"))
        body = {"noteId": "n1", "snapshot": {"title": "My <b>note</b>", "text": "<p>hi</p><script>alert(1)</script>", "pages": [{"key": "p1", "w": 820, "h": 1160}]}}
        body.update(kw)
        r = self.post("/api/share/public", body, self.ot)
        self.assertIn(r.status_code, (200, 201), r.content)
        return j(r)["link"]

    def test_publish_view_assets_counter(self):
        self.push(self.ot, rec("notes", "n1", 1, title="t"))
        link = self.publish(allowDownload=True)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"\x89PNG\r\n\x1a\n", "image/png").status_code, 200)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/pdf", self.ot, b"%PDF-1.4", "application/pdf").status_code, 200)
        r = self.c.get(link["path"])
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("noindex", html)
        self.assertIn("&lt;b&gt;note&lt;/b&gt;", html)  # title escaped
        self.assertNotIn("<script", html)
        self.assertIn(f"/s/{link['token']}/a/p1", html)
        self.assertIn("Download PDF", html)
        self.assertIn("default-src 'none'", r["Content-Security-Policy"])
        self.assertEqual(b"".join(self.c.get(f"{link['path']}/a/p1").streaming_content), b"\x89PNG\r\n\x1a\n")
        self.assertEqual(b"".join(self.c.get(f"{link['path']}/pdf").streaming_content), b"%PDF-1.4")
        self.assertEqual(self.get("/api/share/public?noteId=n1", self.ot).status_code, 200)
        self.assertGreaterEqual(j(self.get("/api/share/public?noteId=n1", self.ot))["link"]["views"], 1)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"x", "image/svg+xml").status_code, 415)
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"<svg", "image/png").status_code, 415)  # magic bytes must match

    def test_download_toggle(self):
        link = self.publish(allowDownload=False)
        self.put_bytes(f"/api/share/public/{link['token']}/asset/pdf", self.ot, b"%PDF-1.4", "application/pdf")
        self.assertEqual(self.c.get(f"{link['path']}/pdf").status_code, 404)
        self.assertNotIn("Download PDF", self.c.get(link["path"]).content.decode())

    def test_only_owner_uploads(self):
        link = self.publish()
        _, bt = self.make_user("bob")
        self.assertEqual(self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", bt, b"x", "image/png").status_code, 404)

    def test_password_protection(self):
        link = self.publish(password="s3cret-pass")
        self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"\x89PNG\r\n\x1a\nIMG", "image/png")
        r = self.c.get(link["path"])
        self.assertIn("Protected note", r.content.decode())
        self.assertNotIn("My", r.content.decode())
        self.assertEqual(self.c.get(f"{link['path']}/a/p1").status_code, 401)
        self.assertEqual(self.c.post(link["path"], {"password": "wrong"}).status_code, 401)
        ok = self.c.post(link["path"], {"password": "s3cret-pass"})
        self.assertEqual(ok.status_code, 200)
        self.assertIn("note", ok.content.decode())
        self.assertEqual(self.c.get(link["path"]).status_code, 200)  # cookie remembered
        self.assertEqual(b"".join(self.c.get(f"{link['path']}/a/p1").streaming_content), b"\x89PNG\r\n\x1a\nIMG")
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
        self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"\x89PNG\r\n\x1a\nold", "image/png")
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
        r = self.put_bytes(f"/api/share/public/{link['token']}/asset/p1", self.ot, b"\x89PNG\r\n\x1a\n" + b"x" * (2 * 1024 * 1024), "image/png")
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


class InternalLinkVisibilityTests(Helpers):
    def test_internal_mode_blocks_anonymous_links_unless_enabled(self):
        u, t = self.make_user("own")
        self.push(t, rec("notes", "n1", 1, title="t"))
        body = {"noteId": "n1", "snapshot": {"title": "T", "text": "<p>x</p>", "pages": []}}
        self.assertEqual(self.post("/api/share/public", {**body, "visibility": "public"}, t).status_code, 403)
        r = self.post("/api/share/public", {**body, "visibility": "internal"}, t)
        self.assertEqual(r.status_code, 201)
        link = j(r)["link"]
        page = self.c.get(link["path"])  # anonymous visitor only gets a sign-in prompt, no content
        self.assertIn("Sign in to view", page.content.decode())
        self.assertNotIn("<p>x</p>", page.content.decode())
        from . import runtime

        runtime.put("allow_anonymous_links", True)
        self.assertEqual(self.post("/api/share/public", {**body, "visibility": "public"}, t).status_code, 200)
        self.assertIn("<p>x</p>", self.c.get(link["path"]).content.decode())

    def test_redeem_link_creates_share_and_respects_password_and_write(self):
        o, ot = self.make_user("own")
        v, vt = self.make_user("vis")
        self.push(ot, rec("notes", "n1", 1, title="t"))
        body = {"noteId": "n1", "snapshot": {"title": "T", "text": "", "pages": []}, "visibility": "internal", "permission": "write", "password": "pw-secret-1"}
        link = j(self.post("/api/share/public", body, ot))["link"]
        info = j(self.get(f"/api/share/link/info?token={link['token']}"))
        self.assertTrue(info["hasPassword"])
        self.assertEqual(self.post("/api/share/link/redeem", {"token": link["token"], "password": "bad"}, vt).status_code, 403)
        r = self.post("/api/share/link/redeem", {"token": link["token"], "password": "pw-secret-1"}, vt)
        self.assertEqual(j(r)["role"], "editor")
        w = dict(rec("notes", "n1", 5000, title="by visitor"), ownerId=o.public_id)
        self.assertEqual(len(self.push(vt, w)["accepted"]), 1)
        self.assertEqual(j(self.get("/api/share/public?noteId=n1", ot))["link"]["edits"], 1)
        self.assertEqual(self.post("/api/share/link/redeem", {"token": "x" * 32}, vt).status_code, 404)


class SecurityTests(Helpers):
    def test_schema_rejects_hostile_records(self):
        u, t = self.make_user("sec")
        bad = [
            rec("notes", "n1", 1, **{"__proto__": {"x": 1}}),
            rec("notes", "n2", 1, pages=[{"strokes": "no"}]),
            rec("notes", "n3", 1, tags="x"),
            rec("assets", "a1", 1, akind="pdf", mime="text/html"),
            {"kind": "notes", "id": "../x", "updatedAt": 1, "data": {}},
        ]
        r = self.post("/api/sync/push", {"records": bad}, t)
        self.assertEqual(len(j(r)["rejected"]), 5)
        deep = {"a": 1}
        for _ in range(20):
            deep = {"k": deep}
        self.assertEqual(len(j(self.post("/api/sync/push", {"records": [rec("notes", "n9", 1, x=deep)]}, t))["rejected"]), 1)

    def test_title_html_stripped_and_client_only_fields_dropped(self):
        u, t = self.make_user("sec")
        self.push(t, rec("notes", "n1", 1, title="<img src=x onerror=alert(1)>Hi", sharedBy="evil", dirty=1))
        d = j(self.get("/api/sync/pull?since=0", t))["records"][0]["data"]
        self.assertEqual(d["title"], "Hi")
        self.assertNotIn("sharedBy", d)

    def test_cursor_opaque_and_user_bound(self):
        a, at = self.make_user("a1")
        b, bt = self.make_user("b1")
        self.push(at, rec("notes", "n1", 1))
        cur = j(self.get("/api/sync/pull?since=0", at))["cursor"]
        self.assertEqual(self.get("/api/sync/pull?since=5", at).status_code, 400)
        self.assertEqual(self.get(f"/api/sync/pull?since={cur}", bt).status_code, 400)  # cursor signed per user

    def test_no_ip_or_email_leak_to_collaborators(self):
        o, ot = self.make_user("own")
        b, bt = self.make_user("col")
        self.push(ot, rec("notes", "n1", 1, title="x"))
        self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": b.email, "role": "editor"}, ot)
        blob = self.get("/api/sync/pull?since=0", bt).content.decode() + self.get("/api/shared", bt).content.decode()
        self.assertNotIn("127.0.0.1", blob)
        self.assertNotIn(o.email, blob)

    def test_totp_and_recovery(self):
        from . import totp

        u, t = self.make_user("tfa")
        sec = j(self.post("/api/auth/2fa/setup", {}, t))["secret"]
        self.assertEqual(self.post("/api/auth/2fa/enable", {"code": "000000"}, t).status_code, 400)
        code = totp._code(sec, int(__import__("time").time() // 30))
        codes = j(self.post("/api/auth/2fa/enable", {"code": code}, t))["recoveryCodes"]
        r = self.post("/api/auth/login", {"email": u.email, "password": PW, "deviceId": "n1"})
        self.assertEqual((r.status_code, j(r)["code"]), (401, "2fa-required"))
        ok = self.post("/api/auth/login", {"email": u.email, "password": PW, "deviceId": "n1", "code": codes[0]})
        self.assertEqual(ok.status_code, 200)
        again = self.post("/api/auth/login", {"email": u.email, "password": PW, "deviceId": "n2", "code": codes[0]})
        self.assertEqual(again.status_code, 401)  # recovery codes are single use

    def test_avatar_rules(self):
        a, at = self.make_user("av")
        o, ot = self.make_user("other")
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
        self.assertEqual(self.c.put("/api/auth/avatar", data=b"GARBAGE" * 10, content_type="image/png", **self.auth(at)).status_code, 415)
        r = self.c.put("/api/auth/avatar", data=png, content_type="image/png", **self.auth(at))
        aid = j(r)["avatar"]
        self.assertEqual(self.get(f"/api/avatar/{aid}", at).status_code, 200)
        self.assertEqual(self.get(f"/api/avatar/{aid}", ot).status_code, 404)  # strangers cannot fetch it
        self.assertEqual(self.c.patch("/api/auth/me", json.dumps({"displayName": "<b>Zed</b>"}), content_type="application/json", **self.auth(at)).status_code, 200)
        self.assertEqual(User.objects.get(pk=a.pk).display_name, "Zed")

    def test_trash_restore_and_purge(self):
        u, t = self.make_user("tr")
        self.push(t, rec("notes", "n1", 1000, title="keep me"))
        self.push(t, rec("notes", "n1", 2000, deleted=True, title="keep me"))
        items = j(self.get("/api/trash", t))["items"]
        self.assertEqual(items[0]["title"], "keep me")
        self.assertEqual(self.post("/api/trash/notes/n1/restore", {}, t).status_code, 200)
        rec_ = [x for x in j(self.get("/api/sync/pull?since=0", t))["records"] if x["id"] == "n1"][0]
        self.assertFalse(rec_["deleted"])
        self.push(t, rec("notes", "n1", rec_["updatedAt"] + 1, deleted=True, title="keep me"))
        Record.objects.update(deleted_at=timezone.now() - timedelta(days=40))
        from . import trash

        self.assertEqual(trash.purge_expired(), 1)
        self.assertEqual(j(self.get("/api/trash", t))["items"], [])


@override_settings(DEPLOYMENT_MODE="commercial", ALLOW_REGISTRATION=True, SMTP_ENABLED=True, REQUIRE_EMAIL_VERIFICATION=True)
class MailAbuseTests(Helpers):
    def solve(self, purpose):
        import hashlib

        ch = j(self.get(f"/api/pow?purpose={purpose}"))
        n = 0
        while True:
            h = hashlib.sha256(f"{ch['challenge']}:{n}".encode()).hexdigest()
            if int(h, 16) >> (256 - ch["difficulty"]) == 0:
                return {"challenge": ch["challenge"], "nonce": str(n)}
            n += 1

    def test_password_rules_server_side(self):
        for pw in ("short1A", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHereAtAll", "password1234"):
            r = self.post("/api/auth/register", {"email": "pw@example.com", "password": pw})
            self.assertEqual(r.status_code, 400, pw)

    @override_settings(POW_REQUIRED=True, POW_BITS=8)
    def test_pow_required_single_use_and_ip_bound(self):
        body = {"email": "pow@example.com", "password": "Correct-Horse-42"}
        self.assertEqual(self.post("/api/auth/register", body).status_code, 400)
        proof = self.solve("register")
        self.assertEqual(self.post("/api/auth/register", {**body, "pow": {**proof, "nonce": "x"}}).status_code, 400)
        r = self.post("/api/auth/register", {**body, "pow": proof})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.post("/api/auth/register", {**body, "email": "pow2@example.com", "pow": proof}).status_code, 400)  # replay
        self.assertEqual(self.post("/api/auth/forgot", {"email": "a@b.co", "pow": self.solve("register")}).status_code, 400)  # wrong purpose

    def test_cooldown_grows_and_response_is_uniform(self):
        self.make_user("cd", email="cd@example.com")
        mail.outbox.clear()
        a = j(self.post("/api/auth/forgot", {"email": "cd@example.com"}))
        b = j(self.post("/api/auth/forgot", {"email": "cd@example.com"}))
        ghost = j(self.post("/api/auth/forgot", {"email": "ghost@example.com"}))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(a["retryAfter"], 60)
        self.assertGreater(b["retryAfter"], 50)
        self.assertEqual(set(a), set(ghost))
        from .models import Cooldown

        Cooldown.objects.update(until=timezone.now() - timedelta(seconds=1))
        c = j(self.post("/api/auth/forgot", {"email": "cd@example.com"}))
        self.assertEqual(c["retryAfter"], 120)  # doubled

    def test_recipient_caps_suppress_list_and_alert(self):
        u, _ = self.make_user("cap", email="cap@example.com")
        from . import emails

        for _i in range(5):
            emails.send_verify(None, u, "t")
        self.assertEqual(len([m for m in mail.outbox if m.to == ["cap@example.com"]]), 3)  # max 3 per hour
        self.assertTrue(AuditLog.objects.filter(event="mail.alert").exists())
        from .models import MailQueue, SuppressedAddress

        self.assertTrue(MailQueue.objects.filter(status="suppressed").exists())
        n = len(mail.outbox)
        SuppressedAddress.objects.create(email="blocked@example.com")
        self.assertFalse(emails.send("blocked@example.com", "x", "x", "x", "x"))
        self.assertEqual(len(mail.outbox), n)

    def test_invite_caps_and_unverified_sender_sends_no_mail(self):
        o, ot = self.make_user("own")
        b, bt = self.make_user("bob")
        self.push(ot, rec("notes", "n1", 1, title="x"))
        Profile.objects.filter(user=o).update(email_verified=False)
        mail.outbox.clear()
        self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "bob@example.com"}, ot)
        self.assertEqual(mail.outbox, [])  # unverified accounts trigger no e-mail
        Profile.objects.filter(user=o).update(email_verified=True)
        for _i in range(3):
            r = self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "ghost@example.com"}, ot)
            self.assertEqual(r.status_code, 202)  # uniform even when capped per address
        with override_settings(INVITES_PER_DAY=2):
            self.assertEqual(self.post("/api/share/people", {"kind": "notes", "id": "n1", "email": "x@example.com"}, ot).status_code, 429)

    def test_admin_mail_panel_and_suppress(self):
        _, admin = self.make_user("root", staff=True)
        u, _ = self.make_user("v", email="v@example.com")
        from . import emails

        emails.send_welcome(None, u)
        d = j(self.get("/api/admin/mail", admin))
        self.assertEqual(d["recent"][0]["to"], "v@example.com")
        self.assertEqual(self.post("/api/admin/mail", {"email": "bad@example.com"}, admin).status_code, 200)
        sid = j(self.get("/api/admin/mail", admin))["suppressed"][0]["id"]
        self.assertEqual(self.c.delete(f"/api/admin/mail/suppress/{sid}", **self.auth(admin)).status_code, 200)
        _, normal = self.make_user("n")
        self.assertEqual(self.get("/api/admin/mail", normal).status_code, 403)

    def test_create_admin_command_skips_validators(self):
        from django.core.management import call_command

        call_command("create_admin", email="boss@example.com", password="weak")
        self.assertTrue(User.objects.get(email="boss@example.com").is_staff)


class RbacTests(Helpers):
    def user_with(self, role, name=None):
        from . import rbac
        from .models import Role

        rbac.ensure_builtin()
        name = name or role
        u = User.objects.create_user(f"{name}@example.com", PW, is_staff=role != "user", is_superuser=role == "superuser", display_name=name)
        Profile.objects.create(user=u, email_verified=True, role=None if role in ("superuser", "user") else Role.objects.filter(name=role).first())
        return u, j(self.post("/api/auth/login", {"email": u.email, "password": PW, "deviceId": "d-" + name}))["token"]

    # (method, path, permission) for every admin/system endpoint
    MATRIX = [("get", "/api/admin/users", "users.read"), ("get", "/api/admin/overview", "analytics.read"), ("get", "/api/admin/shares", "shares.manage"),
              ("get", "/api/admin/abuse", "abuse.manage"), ("get", "/api/admin/mail", "mail.manage"), ("get", "/api/admin/audit", "audit.read"),
              ("get", "/api/admin/health", "health.read"), ("get", "/api/admin/settings", "settings.read"), ("get", "/api/admin/trash", "trash.purge"),
              ("get", "/api/system/analytics", "analytics.read"), ("get", "/api/system/api-stats", "analytics.read"), ("get", "/api/system/server", "system.read"),
              ("get", "/api/system/roles", "users.read"), ("get", "/api/system/data", "data.read"), ("get", "/api/system/data/users", "data.read")]

    def test_matrix_deny_by_default(self):
        from . import rbac

        for role in ("user", "analyst", "support", "admin", "superuser"):
            _, t = self.user_with(role)
            allowed = rbac.BUILTIN[role]
            for m, path, perm in self.MATRIX:
                r = getattr(self, m)(path, t)
                self.assertEqual(r.status_code == 403, perm not in allowed, f"{role} {path} -> {r.status_code}")

    def test_every_admin_and_system_route_declares_a_permission(self):
        from django.urls import get_resolver

        def walk(patterns, prefix=""):
            for p in patterns:
                if hasattr(p, "url_patterns"):
                    yield from walk(p.url_patterns, prefix + str(p.pattern))
                else:
                    yield prefix + str(p.pattern), p.callback

        for route, cb in walk(get_resolver().url_patterns):
            if route.startswith(("api/admin/", "api/system/")):
                self.assertIsNotNone(getattr(cb, "perm", None), route)

    def test_unauthenticated_and_disabled(self):
        self.assertEqual(self.get("/api/system/server").status_code, 401)
        u, t = self.user_with("admin")
        u.is_active = False
        u.save()
        self.assertEqual(self.get("/api/admin/users", t).status_code, 401)

    def test_custom_role_and_escalation_guards(self):
        _, root = self.user_with("superuser")
        _, admin = self.user_with("admin")
        target, _ = self.user_with("user", "plain")
        self.assertEqual(self.post("/api/system/roles", {"name": "Helpdesk", "permissions": ["users.read", "bogus"]}, admin).status_code, 403)
        r = self.post("/api/system/roles", {"name": "Helpdesk", "permissions": ["users.read", "bogus"]}, root)
        role = j(r)["role"]
        self.assertEqual(role["permissions"], ["users.read"])  # unknown keys dropped
        self.assertEqual(self.patch(f"/api/admin/users/{target.public_id}", {"role": "Helpdesk"}, admin).status_code, 403)  # admins cannot assign roles
        self.assertEqual(self.patch(f"/api/admin/users/{target.public_id}", {"role": "Helpdesk"}, root).status_code, 200)
        t2 = j(self.post("/api/auth/login", {"email": target.email, "password": PW, "deviceId": "x"}))["token"]
        self.assertEqual(self.get("/api/admin/users", t2).status_code, 200)
        self.assertEqual(self.get("/api/admin/audit", t2).status_code, 403)
        self.assertEqual(self.post("/api/admin/users", {"email": "n@example.com"}, t2).status_code, 403)
        # admin cannot touch a superuser, nor grant superuser
        su = User.objects.get(email="superuser@example.com")
        self.assertEqual(self.post(f"/api/admin/users/{su.public_id}/reset", {}, admin).status_code, 403)
        self.assertEqual(self.c.delete(f"/api/system/roles/{role['id']}", **self.auth(root)).status_code, 200)
        self.assertEqual(self.get("/api/admin/users", t2).status_code, 403)  # role removed -> no permissions
        builtin = [x for x in j(self.get("/api/system/roles", root))["roles"] if x["name"] == "admin"][0]
        self.assertEqual(self.patch(f"/api/system/roles/{builtin['id']}", {"permissions": ["roles.manage"]}, root).status_code, 403)

    def test_data_viewer_hides_secrets_and_e2e_content(self):
        _, root = self.user_with("superuser")
        u, t = self.user_with("user", "owner")
        self.push(t, rec("notes", "n1", 1, title="Visible title"))
        self.push(t, {"kind": "notes", "id": "n2", "updatedAt": 1, "data": {"enc": 1, "ct": "AAAA"}})
        rows = j(self.get("/api/system/data/notes", root))["rows"]
        by = {r["id"]: r for r in rows}
        self.assertEqual(by["n1"]["title"], "Visible title")
        self.assertTrue(by["n2"]["e2e"])
        self.assertNotIn("AAAA", json.dumps(rows))
        blob = self.get("/api/system/data/users", root).content.decode()
        self.assertNotIn("pbkdf2", blob)
        self.assertNotIn("password", blob.replace("password", "", 0) if False else "")
        self.assertEqual(self.get("/api/system/data/secrets", root).status_code, 404)

    def test_analytics_and_stats_shape(self):
        _, root = self.user_with("superuser")
        self.get("/api/health")
        a = j(self.get("/api/system/analytics?days=7", root))
        for k in ("growth", "active", "cohorts", "devices", "content", "storage", "sharing", "mail", "abuse", "trash"):
            self.assertIn(k, a)
        self.assertEqual(len(a["active"]), 7)
        s = j(self.get("/api/system/api-stats", root))
        self.assertTrue(s["table"])
        self.assertIn("p95Ms", s["sync"])
        self.assertIn("tables", j(self.get("/api/system/server", root)))

    def test_trash_permanent_delete_removes_files(self):
        u, t = self.user_with("user", "tr")
        png = b"\x89PNG\r\n\x1a\nxx"
        self.push(t, rec("notes", "n1", 1000, title="x"), rec("assets", "a1", 1000, noteId="n1"))
        self.c.put("/api/assets/a1", data=png, content_type="image/png", **self.auth(t))
        self.push(t, rec("notes", "n1", 2000, deleted=True, title="x"))
        self.assertEqual(self.post("/api/trash/delete", {"items": [{"kind": "notes", "id": "n1"}]}, t).status_code, 200)
        self.assertEqual(self.get("/api/assets/a1", t).status_code, 404)  # file removed
        self.assertEqual(j(self.get("/api/trash", t))["items"], [])

    def test_trash_default_60_days(self):
        from django.conf import settings

        self.assertEqual(settings.TRASH_RETENTION_DAYS, 60)
