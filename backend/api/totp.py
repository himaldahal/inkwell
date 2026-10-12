"""RFC 6238 TOTP (pure python) + recovery codes."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def new_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret, step):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1000000:06d}"


def verify(secret, code, last_step=0, window=1):
    """Return the matched time step (> last_step, so a code cannot be replayed) or None."""
    code = str(code or "").strip().replace(" ", "")
    if len(code) != 6 or not code.isdigit():
        return None
    now = int(time.time() // 30)
    for s in range(now - window, now + window + 1):
        if s > last_step and hmac.compare_digest(_code(secret, s), code):
            return s
    return None


def uri(secret, email, issuer="Inkwell"):
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"


def new_recovery():
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(8)]
    return codes, [hashlib.sha256(c.encode()).hexdigest() for c in codes]


def use_recovery(hashes, code):
    h = hashlib.sha256(str(code or "").strip().lower().encode()).hexdigest()
    for x in hashes:
        if hmac.compare_digest(x, h):
            return [y for y in hashes if y != x]
    return None
