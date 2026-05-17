"""HMAC-SHA256 session token, symmetrical with apps/frontend/src/middleware.ts.

The token is `urlsafe_b64encode(HMAC_SHA256(secret, pat_uid + ':' + date_str))`,
with `=` padding STRIPPED to match Node's `crypto.createHmac(...).digest('base64url')`
(Node strips padding by default per RFC 4648 §3.2; Python `urlsafe_b64encode`
keeps it, so we strip explicitly to keep the two encoders byte-for-byte equal).
"""

import base64
import hashlib
import hmac


def sign(secret: str, pat_uid: str, date_str: str) -> str:
    """Return URL-safe base64 token (no padding) of HMAC_SHA256(secret, pat_uid + ':' + date_str)."""
    mac = hmac.new(
        secret.encode("utf-8"),
        f"{pat_uid}:{date_str}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")


def verify(secret: str, pat_uid: str, date_str: str, token: str) -> bool:
    """Constant-time compare of token against the expected HMAC.

    Returns False for missing/empty/non-string tokens (defensive — the auth path
    must surface as a clean 401, never a TypeError 500).
    """
    if not token or not isinstance(token, str):
        return False
    expected = sign(secret, pat_uid, date_str)
    return hmac.compare_digest(expected, token)
