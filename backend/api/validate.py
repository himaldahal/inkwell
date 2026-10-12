"""Strict validation of synced records. All synced content is treated as hostile."""
import re
from html.parser import HTMLParser

from django.conf import settings

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
FORBIDDEN = {"__proto__", "constructor", "prototype"}
DROP = {"dirty", "blob", "shared", "sharedBy", "sharedRole", "publicLink", "publicToken", "passwordProtected", "shares", "owner", "ownerId", "role"}
MAX_DEPTH, MAX_NODES, MAX_STR, MAX_NUM = 8, 2_000_000, 4_000_000, 1e15
ASSET_KINDS = {"image", "pdf", "audio"}
MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "video/webm", "video/mp4"}


class _T(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.o, self.skip = [], 0

    def handle_starttag(self, t, a):
        self.skip += t in ("script", "style")

    def handle_endtag(self, t):
        self.skip -= (t in ("script", "style")) and self.skip > 0

    def handle_data(self, d):
        if not self.skip:
            self.o.append(d)


def plain(s, limit):
    p = _T()
    p.feed(str(s)[: limit * 4])
    p.close()
    return "".join(p.o).replace("<", "").replace(">", "").strip()[:limit]


def _walk(v, depth, budget):
    budget[0] -= 1
    if budget[0] < 0 or depth > MAX_DEPTH:
        raise ValueError("record is too complex")
    if isinstance(v, dict):
        for k, x in v.items():
            if not isinstance(k, str) or k in FORBIDDEN or not (KEY_RE.match(k) or ID_RE.match(k)):
                raise ValueError("invalid field name")
            _walk(x, depth + 1, budget)
    elif isinstance(v, list):
        for x in v:
            _walk(x, depth + 1, budget)
    elif isinstance(v, str):
        if len(v) > MAX_STR:
            raise ValueError("string too long")
    elif isinstance(v, bool) or v is None:
        pass
    elif isinstance(v, (int, float)):
        if v != v or abs(v) > MAX_NUM:
            raise ValueError("number out of range")
    else:
        raise ValueError("unsupported value")


def _t(d, key, typ, maxlen=None, nullable=False, enum=None, strip=False):
    if key not in d:
        return
    v = d[key]
    if v is None and nullable:
        return
    if typ is bool and not isinstance(v, bool):
        raise ValueError(f"{key} must be boolean")
    if typ is str:
        if not isinstance(v, str) or (maxlen and len(v) > maxlen):
            raise ValueError(f"{key} must be a string up to {maxlen}")
        if strip:
            d[key] = plain(v, maxlen)
        if enum and d[key] not in enum:
            raise ValueError(f"{key} is not allowed")
    if typ is float and (isinstance(v, bool) or not isinstance(v, (int, float))):
        raise ValueError(f"{key} must be a number")
    if typ is list and (not isinstance(v, list) or (maxlen and len(v) > maxlen)):
        raise ValueError(f"{key} must be a list up to {maxlen}")


def clean_record(kind, data):
    """Return a sanitized copy of `data` or raise ValueError."""
    if not isinstance(data, dict):
        raise ValueError("data must be an object")
    if data.get("enc"):  # end-to-end encrypted envelope: opaque
        ct = data.get("ct")
        if set(data) - {"enc", "ct"} or not isinstance(ct, str) or len(ct) > settings.MAX_RECORD_BYTES:
            raise ValueError("bad encrypted envelope")
        return {"enc": 1, "ct": ct}
    d = {k: v for k, v in data.items() if k not in DROP}
    _walk(d, 0, [MAX_NODES])
    if "id" in d and not (isinstance(d["id"], str) and ID_RE.match(d["id"])):
        raise ValueError("bad id")
    for k in ("createdAt", "updatedAt"):
        _t(d, k, float, nullable=True)
    _t(d, "deleted", bool)
    if kind == "notes":
        _t(d, "title", str, 300, strip=True)
        _t(d, "notebookId", str, 64, nullable=True)
        _t(d, "tags", list, 100)
        d["tags"] = [plain(t, 60) for t in d.get("tags", []) if isinstance(t, str)][:100] if "tags" in d else None
        if d["tags"] is None:
            del d["tags"]
        for b in ("pinned", "favorite", "archived"):
            _t(d, b, bool)
        _t(d, "trashedAt", float, nullable=True)
        _t(d, "template", str, 24)
        _t(d, "paperColor", str, 40, nullable=True)
        _t(d, "text", str, settings.PUBLIC_MAX_TEXT_BYTES)
        _t(d, "textIndex", str, settings.PUBLIC_MAX_TEXT_BYTES)
        _t(d, "preview", str, 700_000, nullable=True)
        _t(d, "pages", list, 1000)
        _t(d, "recordings", list, 1000)
        _t(d, "assignees", list, 50)
        for p in d.get("pages", []):
            if not isinstance(p, dict):
                raise ValueError("bad page")
            _t(p, "strokes", list, 200_000)
            _t(p, "items", list, 20_000)
            _t(p, "width", float)
            _t(p, "height", float)
    elif kind == "notebooks":
        _t(d, "name", str, 200, strip=True)
        _t(d, "color", str, 40, nullable=True)
        _t(d, "icon", str, 60, nullable=True)
        _t(d, "parentId", str, 64, nullable=True)
        _t(d, "order", float, nullable=True)
    elif kind == "assets":
        _t(d, "noteId", str, 64, nullable=True)
        _t(d, "kind", str, 10, enum=ASSET_KINDS)
        _t(d, "mime", str, 40, nullable=True)
        if d.get("mime") and d["mime"] not in MIMES:
            raise ValueError("unsupported file type")
        _t(d, "size", float, nullable=True)
    return d


MAGIC = [
    (0, b"\x89PNG\r\n\x1a\n", "image/png"), (0, b"\xff\xd8\xff", "image/jpeg"), (0, b"GIF8", "image/gif"),
    (0, b"%PDF", "application/pdf"), (0, b"\x1a\x45\xdf\xa3", "webm"), (0, b"OggS", "audio/ogg"),
    (0, b"RIFF", "riff"), (4, b"ftyp", "mp4"), (0, b"ID3", "audio/mpeg"), (0, b"\xff\xfb", "audio/mpeg"),
]


def sniff(head: bytes):
    """Detect the real type from magic bytes; None if not on the allow-list."""
    for off, sig, kind in MAGIC:
        if head[off: off + len(sig)] == sig:
            if kind == "riff":
                return "image/webp" if head[8:12] == b"WEBP" else ("audio/wav" if head[8:12] == b"WAVE" else None)
            return kind
    return None


def mime_ok(declared, sniffed):
    """Declared Content-Type must be consistent with the sniffed bytes."""
    declared = (declared or "").split(";")[0].strip().lower()
    fam = {"webm": ("audio/webm", "video/webm"), "mp4": ("audio/mp4", "video/mp4")}
    ok = fam.get(sniffed, (sniffed,))
    return declared in ok and declared in MIMES
