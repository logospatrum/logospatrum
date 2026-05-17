"""HMAC-SHA256 session token, symmetrical with apps/frontend/src/middleware.ts.

The token is `urlsafe_b64encode(HMAC_SHA256(secret, pat_uid + ':' + date_str))`.
The corresponding TS implementation in middleware.ts uses
`crypto.createHmac('sha256', secret).update(`${patUid}:${date}`).digest('base64url')`
which produces byte-for-byte identical output (base64url == urlsafe_b64encode).
"""

import base64
import hashlib
import hmac


def sign(secret: str, pat_uid: str, date_str: str) -> str:
    """Return URL-safe base64 token of HMAC_SHA256(secret, pat_uid + ':' + date_str)."""
    mac = hmac.new(
        secret.encode("utf-8"),
        f"{pat_uid}:{date_str}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii")


def verify(secret: str, pat_uid: str, date_str: str, token: str) -> bool:
    """Constant-time compare of token against the expected HMAC."""
    expected = sign(secret, pat_uid, date_str)
    return hmac.compare_digest(expected, token)
