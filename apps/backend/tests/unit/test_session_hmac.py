import pytest
from backend.budget import session as sess

SECRET = "0" * 64  # 32-byte hex


def test_sign_then_verify_roundtrip():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    assert sess.verify(SECRET, "cookie:abc", "2026-05-17", token) is True


def test_verify_fails_on_tampered_token():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert sess.verify(SECRET, "cookie:abc", "2026-05-17", tampered) is False


def test_verify_fails_on_wrong_cookie():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    assert sess.verify(SECRET, "cookie:xyz", "2026-05-17", token) is False


def test_verify_fails_on_wrong_date():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    assert sess.verify(SECRET, "cookie:abc", "2026-05-18", token) is False


def test_verify_fails_on_wrong_secret():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    other = "1" * 64
    assert sess.verify(other, "cookie:abc", "2026-05-17", token) is False


def test_token_is_url_safe_base64():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    import string
    allowed = string.ascii_letters + string.digits + "-_="
    assert all(ch in allowed for ch in token)
