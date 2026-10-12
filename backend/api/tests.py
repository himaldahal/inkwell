import json
import shutil
import tempfile

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .models import Device, Token

TMP = tempfile.mkdtemp(prefix="inkwell-test-")


def j(r):
    return json.loads(r.content)


@override_settings(MEDIA_ROOT=__import__("pathlib").Path(TMP), ALLOW_REGISTRATION=True)
class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.c = Client()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP, ignore_errors=True)

    def post(self, path, body, token=None):
        h = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
        return self.c.post(path, json.dumps(body), content_type="application/json", **h)

    def get(self, path, token=None, **extra):
        h = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
        return self.c.get(path, **h, **extra)

    def register(self, name="alice", device="dev-a", pw="correct-horse-42"):
        r = self.post("/api/auth/register", {"username": name, "password": pw, "deviceId": device, "deviceName": device})
        self.assertEqual(r.status_code, 200, r.content)
        return j(r)["token"]

    def login(self, name="alice", device="dev-b", pw="correct-horse-42"):
        r = self.post("/api/auth/login", {"username": name, "password": pw, "deviceId": device, "deviceName": device})
        self.assertEqual(r.status_code, 200, r.content)
        return j(r)["token"]

    def push(self, token, *recs):
        r = self.post("/api/sync/push", {"records": list(recs)}, token)
        self.assertEqual(r.status_code, 200, r.content)
        return j(r)


def rec(kind, id, ua, deleted=False, **data):
    return {"kind": kind, "id": id, "updatedAt": ua, "deleted": deleted, "data": {"id": id, "updatedAt": ua, **data}}


class AuthTests(Base):
    def test_register_login_me_logout(self):
        t = self.register()
        me = j(self.get("/api/auth/me", t))
        self.assertEqual(me["user"]["username"], "alice")
        self.assertEqual(self.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.get("/api/auth/me", "nope").status_code, 401)
        self.assertEqual(self.post("/api/auth/logout", {}, t).status_code, 200)
        self.assertEqual(self.get("/api/auth/me", t).status_code, 401)

    def test_token_stored_hashed(self):
        t = self.register()
        self.assertFalse(Token.objects.filter(key_hash=t).exists())
        self.assertEqual(len(Token.objects.get().key_hash), 64)

    def test_duplicate_and_weak_password(self):
        self.register()
        r = self.post("/api/auth/register", {"username": "ALICE", "password": "correct-horse-42"})
        self.assertEqual(r.status_code, 409)
        r = self.post("/api/auth/register", {"username": "bob", "password": "123"})
        self.assertEqual(r.status_code, 400)

    def test_bad_login(self):
        self.register()
        r = self.post("/api/auth/login", {"username": "alice", "password": "wrong"})
        self.assertEqual(r.status_code, 401)

    def test_login_throttle(self):
        self.register()
        codes = [self.post("/api/auth/login", {"username": "alice", "password": "x"}).status_code for _ in range(12)]
        self.assertIn(429, codes)

    @override_settings(ALLOW_REGISTRATION=False)
    def test_registration_toggle(self):
        r = self.post("/api/auth/register", {"username": "alice", "password": "correct-horse-42"})
        self.assertEqual(r.status_code, 403)

    def test_change_password_signs_out_others(self):
        a = self.register()
        b = self.login()
        r = self.post("/api/auth/password", {"oldPassword": "bad", "newPassword": "another-pass-77"}, a)
        self.assertEqual(r.status_code, 403)
        r = self.post("/api/auth/password", {"oldPassword": "correct-horse-42", "newPassword": "another-pass-77"}, a)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.get("/api/auth/me", a).status_code, 200)
        self.assertEqual(self.get("/api/auth/me", b).status_code, 401)
        self.login(pw="another-pass-77", device="dev-c")

    def test_delete_account(self):
        t = self.register()
        self.push(t, rec("notes", "n1", 1000, title="x"))
        self.assertEqual(self.post("/api/auth/delete", {"password": "no"}, t).status_code, 403)
        self.assertEqual(self.post("/api/auth/delete", {"password": "correct-horse-42"}, t).status_code, 200)
        self.assertEqual(self.get("/api/auth/me", t).status_code, 401)
        self.assertEqual(self.post("/api/auth/login", {"username": "alice", "password": "correct-horse-42"}).status_code, 401)

    def test_token_expiry_and_refresh(self):
        from datetime import timedelta

        from django.utils import timezone

        t = self.register()
        new = j(self.post("/api/auth/refresh", {}, t))["token"]
        self.assertEqual(self.get("/api/auth/me", t).status_code, 401)
        self.assertEqual(self.get("/api/auth/me", new).status_code, 200)
        Token.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.get("/api/auth/me", new).status_code, 401)

    def test_health_and_headers(self):
        r = self.get("/api/health")
        self.assertTrue(j(r)["ok"])
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")

    def test_cors(self):
        with override_settings(CORS_ALLOWED_ORIGINS=["https://x.example"]):
            r = self.c.options("/api/sync/pull", HTTP_ORIGIN="https://x.example", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET")
            self.assertEqual(r.status_code, 204)
            self.assertEqual(r["Access-Control-Allow-Origin"], "https://x.example")
            r = self.c.options("/api/sync/pull", HTTP_ORIGIN="https://evil.example", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET")
            self.assertNotIn("Access-Control-Allow-Origin", r)


class SyncTests(Base):
    def test_push_pull_roundtrip_and_cursor(self):
        t = self.register()
        r = self.push(t, rec("notebooks", "nb1", 1000, name="Math"), rec("notes", "n1", 1000, title="Hello"))
        self.assertEqual(len(r["accepted"]), 2)
        p = j(self.get("/api/sync/pull?since=0", t))
        self.assertEqual({x["id"] for x in p["records"]}, {"nb1", "n1"})
        seqs = [x["seq"] for x in p["records"]]
        self.assertEqual(seqs, sorted(seqs))
        cur = p["cursor"]
        self.assertEqual(j(self.get(f"/api/sync/pull?since={cur}", t))["records"], [])
        self.push(t, rec("notes", "n1", 2000, title="Hello 2"))
        p2 = j(self.get(f"/api/sync/pull?since={cur}", t))
        self.assertEqual([x["data"]["title"] for x in p2["records"]], ["Hello 2"])
        self.assertGreater(p2["cursor"], cur)

    def test_pull_pagination_and_etag(self):
        t = self.register()
        self.push(t, *[rec("notes", f"n{i}", 1000 + i, title=str(i)) for i in range(5)])
        p = j(self.get("/api/sync/pull?since=0&limit=2", t))
        self.assertTrue(p["hasMore"])
        self.assertEqual(len(p["records"]), 2)
        r = self.get(f"/api/sync/pull?since={p['cursor']}&limit=2", t)
        tag = r["ETag"]
        r2 = self.get(f"/api/sync/pull?since={p['cursor']}&limit=2", t, HTTP_IF_NONE_MATCH=tag)
        self.assertEqual(r2.status_code, 304)
        self.push(t, rec("notes", "zz", 5000))
        r3 = self.get(f"/api/sync/pull?since={p['cursor']}&limit=2", t, HTTP_IF_NONE_MATCH=tag)
        self.assertEqual(r3.status_code, 200)

    def test_lww_older_rejected_newer_accepted(self):
        t = self.register()
        self.push(t, rec("notes", "n1", 5000, title="new"))
        r = self.push(t, rec("notes", "n1", 4000, title="old"))
        self.assertEqual(r["accepted"], [])
        self.assertEqual(r["conflicts"][0]["data"]["title"], "new")
        r = self.push(t, rec("notes", "n1", 6000, title="newer"))
        self.assertEqual(len(r["accepted"]), 1)
        p = j(self.get("/api/sync/pull?since=0", t))
        self.assertEqual(p["records"][0]["data"]["title"], "newer")

    def test_idempotent_push_keeps_seq(self):
        t = self.register()
        a = self.push(t, rec("notes", "n1", 5000, title="a"))
        b = self.push(t, rec("notes", "n1", 5000, title="a"))
        self.assertEqual(a["accepted"][0]["seq"], b["accepted"][0]["seq"])

    def test_tombstones(self):
        t = self.register()
        self.push(t, rec("notes", "n1", 1000, title="a"))
        self.push(t, rec("notes", "n1", 2000, deleted=True))
        r = self.push(t, rec("notes", "n1", 1500, title="resurrect"))  # older edit must not undelete
        self.assertEqual(len(r["conflicts"]), 1)
        self.assertTrue(r["conflicts"][0]["deleted"])
        p = j(self.get("/api/sync/pull?since=0", t))
        self.assertTrue(p["records"][0]["deleted"])
        # tie: delete wins
        r = self.push(t, rec("notes", "n1", 2000, title="tie"))
        self.assertEqual(len(r["conflicts"]), 1)
        # genuinely newer edit revives
        r = self.push(t, rec("notes", "n1", 3000, title="revive"))
        self.assertEqual(len(r["accepted"]), 1)

    def test_validation_and_limits(self):
        t = self.register()
        r = self.post("/api/sync/push", {"records": [{"kind": "evil", "id": "x", "updatedAt": 1}, {"nope": 1}]}, t)
        self.assertEqual(len(j(r)["rejected"]), 2)
        with override_settings(MAX_PUSH_RECORDS=1):
            r = self.post("/api/sync/push", {"records": [rec("notes", "a", 1), rec("notes", "b", 1)]}, t)
            self.assertEqual(r.status_code, 413)
        with override_settings(MAX_RECORD_BYTES=10):
            r = self.push(t, rec("notes", "big", 1, title="x" * 100))
            self.assertEqual(r["rejected"][0]["error"], "record too large")
        self.assertEqual(self.post("/api/sync/push", {"records": "x"}, t).status_code, 400)
        self.assertEqual(self.get("/api/sync/push", t).status_code, 405)

    def test_future_timestamp_clamped(self):
        t = self.register()
        r = self.push(t, rec("notes", "n1", 9_999_999_999_999))
        self.assertLess(r["accepted"][0]["updatedAt"], 9_999_999_999_999)

    def test_user_isolation(self):
        a = self.register("alice")
        b = self.register("bobby", device="dev-x")
        self.push(a, rec("notes", "shared-id", 1000, title="alice secret"))
        self.assertEqual(j(self.get("/api/sync/pull?since=0", b))["records"], [])
        # bob writing the same id doesn't touch alice's
        self.push(b, rec("notes", "shared-id", 2000, title="bob"))
        pa = j(self.get("/api/sync/pull?since=0", a))["records"]
        self.assertEqual([x["data"]["title"] for x in pa], ["alice secret"])
        # assets isolated too
        self.c.put("/api/assets/img1", data=b"abc", content_type="image/png", HTTP_AUTHORIZATION=f"Bearer {a}")
        self.assertEqual(self.get("/api/assets/img1", b).status_code, 404)
        self.assertEqual(self.get("/api/assets/img1", a).status_code, 200)
        self.assertEqual(self.c.delete("/api/assets/img1", HTTP_AUTHORIZATION=f"Bearer {b}").status_code, 200)
        self.assertEqual(self.get("/api/assets/img1", a).status_code, 200)


class AssetTests(Base):
    def put(self, t, aid, data, ctype="application/pdf"):
        return self.c.put(f"/api/assets/{aid}", data=data, content_type=ctype, HTTP_AUTHORIZATION=f"Bearer {t}")

    def test_upload_download(self):
        t = self.register()
        blob = bytes(range(256)) * 100
        self.assertEqual(self.put(t, "a1", blob).status_code, 200)
        r = self.get("/api/assets/a1", t)
        self.assertEqual(b"".join(r.streaming_content), blob)
        self.assertEqual(r["Content-Type"], "application/pdf")
        r2 = self.get("/api/assets/a1", t, HTTP_IF_NONE_MATCH=r["ETag"])
        self.assertEqual(r2.status_code, 304)
        self.assertEqual(self.get("/api/assets/missing", t).status_code, 404)
        self.assertEqual(self.get("/api/assets/a1").status_code, 401)
        self.assertEqual(self.put(t, "../etc", b"x").status_code, 404)
        self.assertEqual(self.put(t, "bad id", b"x").status_code, 400)

    def test_quota(self):
        from .models import Profile

        t = self.register()
        Profile.objects.update_or_create(user__username="alice", defaults={"user": __import__("django.contrib.auth", fromlist=["x"]).get_user_model().objects.get(username="alice"), "storage_mb_override": 1})
        mb = 1024 * 1024
        self.assertEqual(self.put(t, "a", b"x" * (600 * 1024)).status_code, 200)
        self.assertEqual(self.put(t, "b", b"x" * (600 * 1024)).status_code, 413)
        self.assertEqual(self.put(t, "a", b"x" * (900 * 1024)).status_code, 200)  # replace counts net
        used = j(self.get("/api/auth/me", t))["usage"]["assetBytes"]
        self.assertEqual(used, 900 * 1024)
        self.assertEqual(j(self.get("/api/auth/me", t))["usage"]["quotaBytes"], mb)

    @override_settings(ASSET_MAX_BYTES=10)
    def test_max_size(self):
        t = self.register()
        self.assertEqual(self.put(t, "a", b"x" * 20).status_code, 413)

    def test_tombstone_removes_blob(self):
        t = self.register()
        self.put(t, "a1", b"hello")
        self.push(t, rec("assets", "a1", 1000, noteId="n", akind="pdf"))
        self.push(t, rec("assets", "a1", 2000, deleted=True))
        self.assertEqual(self.get("/api/assets/a1", t).status_code, 404)


class MultiDeviceTests(Base):
    def test_two_devices_converge_with_offline_queue_and_conflict(self):
        a = self.register(device="phone")
        b = self.login(device="laptop")
        self.assertEqual(Device.objects.count(), 2)
        # phone creates a note online
        self.push(a, rec("notes", "n1", 1000, title="shared", text="base"))
        # laptop pulls it
        pb = j(self.get("/api/sync/pull?since=0", b))
        cur_b = pb["cursor"]
        self.assertEqual(pb["records"][0]["data"]["title"], "shared")
        # both edit "offline"; laptop reconnects first and flushes its queue (two queued edits)
        r = self.push(b, rec("notes", "n1", 3000, title="shared", text="laptop"), rec("notes", "n2", 3100, title="queued"))
        self.assertEqual(len(r["accepted"]), 2)
        # phone (older edit) comes online: rejected as conflict -> client keeps a conflicted copy and re-pushes it
        r = self.push(a, rec("notes", "n1", 2000, title="shared", text="phone"))
        self.assertEqual(len(r["conflicts"]), 1)
        self.assertEqual(r["conflicts"][0]["data"]["text"], "laptop")
        copy = rec("notes", "n1-conflict", 4000, title="shared (conflict)", text="phone")
        self.assertEqual(len(self.push(a, copy)["accepted"]), 1)
        # both devices converge on the same state
        pa = {x["id"]: x["data"] for x in j(self.get("/api/sync/pull?since=0", a))["records"]}
        pb2 = {x["id"]: x["data"] for x in j(self.get(f"/api/sync/pull?since=0", b))["records"]}
        self.assertEqual(pa, pb2)
        self.assertEqual(set(pa), {"n1", "n2", "n1-conflict"})
        self.assertEqual(pa["n1"]["text"], "laptop")
        # incremental from the laptop cursor yields only what it hasn't seen
        inc = j(self.get(f"/api/sync/pull?since={cur_b}", b))["records"]
        self.assertTrue(all(x["seq"] > cur_b for x in inc))

    def test_device_list_and_revoke(self):
        a = self.register(device="phone")
        b = self.login(device="laptop")
        ds = j(self.get("/api/devices", a))["devices"]
        self.assertEqual({d["id"] for d in ds}, {"phone", "laptop"})
        self.assertTrue([d for d in ds if d["id"] == "phone"][0]["current"])
        self.assertEqual(self.c.delete("/api/devices/laptop", HTTP_AUTHORIZATION=f"Bearer {a}").status_code, 200)
        self.assertEqual(self.get("/api/auth/me", b).status_code, 401)
        self.assertEqual(self.get("/api/auth/me", a).status_code, 200)
        self.assertEqual(self.c.delete("/api/devices/nope", HTTP_AUTHORIZATION=f"Bearer {a}").status_code, 404)

    def test_relogin_same_device_replaces_token(self):
        a = self.register(device="phone")
        a2 = self.login(device="phone")
        self.assertEqual(self.get("/api/auth/me", a).status_code, 401)
        self.assertEqual(self.get("/api/auth/me", a2).status_code, 200)
        self.assertEqual(Device.objects.count(), 1)


class AppServingTests(Base):
    def test_index_and_spa(self):
        for p in ("/", "/some/route"):
            r = self.c.get(p)
            self.assertIn(r.status_code, (200, 503))
