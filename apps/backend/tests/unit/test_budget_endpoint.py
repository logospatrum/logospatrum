import pytest
from fastapi.testclient import TestClient

from backend.catalog import app
from backend.budget import storage


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.asyncio
async def test_cookie_subject_allowed_when_under_limit(db_clean, client):
    await storage.add_usage("cookie:test1", storage._today_msk(), 100.0)
    r = client.get("/budget/check", params={"subject": "cookie:test1"})
    assert r.status_code == 200
    data = r.json()
    assert data["allowed"] is True
    assert data["warn"] is False
    assert data["used_rub"] == pytest.approx(100.0)
    assert data["limit_rub"] == pytest.approx(500.0)


@pytest.mark.asyncio
async def test_cookie_subject_warn_at_80pct(db_clean, client):
    await storage.add_usage("cookie:test2", storage._today_msk(), 400.0)
    r = client.get("/budget/check", params={"subject": "cookie:test2"})
    data = r.json()
    assert data["allowed"] is True
    assert data["warn"] is True


@pytest.mark.asyncio
async def test_cookie_subject_denied_at_100pct(db_clean, client):
    await storage.add_usage("cookie:test3", storage._today_msk(), 501.0)
    r = client.get("/budget/check", params={"subject": "cookie:test3"})
    data = r.json()
    assert data["allowed"] is False


@pytest.mark.asyncio
async def test_ip_subject_uses_lower_limit(db_clean, client):
    # IP cap = 250 ₽
    await storage.add_usage("ip:1.2.3.4", storage._today_msk(), 251.0)
    r = client.get("/budget/check", params={"subject": "ip:1.2.3.4"})
    data = r.json()
    assert data["allowed"] is False
    assert data["limit_rub"] == pytest.approx(250.0)


@pytest.mark.asyncio
async def test_global_month_subject(db_clean, client):
    await storage.add_usage("__global_month", storage._this_month_msk(), 30_001.0)
    r = client.get("/budget/check", params={"subject": "__global_month"})
    data = r.json()
    assert data["allowed"] is False
    assert data["limit_rub"] == pytest.approx(30_000.0)


@pytest.mark.asyncio
async def test_kill_switch_disables_gate(monkeypatch, db_clean, client):
    # BUDGET_GUARD_ENABLED=false → /budget/check returns allowed=True regardless
    # of actual usage. Verifies the rollback knob promised in the spec works.
    await storage.add_usage("cookie:exhausted", storage._today_msk(), 9999.0)
    monkeypatch.setattr("backend.config.settings.budget_guard_enabled", False)
    r = client.get("/budget/check", params={"subject": "cookie:exhausted"})
    data = r.json()
    assert data["allowed"] is True
    assert data["warn"] is False


@pytest.mark.asyncio
async def test_kill_switch_disables_global_month(monkeypatch, db_clean, client):
    await storage.add_usage("__global_month", storage._this_month_msk(), 99_999.0)
    monkeypatch.setattr("backend.config.settings.budget_guard_enabled", False)
    r = client.get("/budget/check", params={"subject": "__global_month"})
    data = r.json()
    assert data["allowed"] is True
    assert data["warn"] is False


def test_session_refresh_returns_token_for_cookie(monkeypatch, client):
    monkeypatch.setattr("backend.config.settings.pat_session_secret", "0" * 64)
    r = client.get("/session/refresh", params={"cookie": "abc-uid"})
    assert r.status_code == 200
    data = r.json()
    assert data["token"]
    assert len(data["token"]) == 43  # urlsafe base64 of 32 bytes, no padding
    assert "=" not in data["token"]  # Node-symmetric (stripped padding)
    assert data["expires_at"]


def test_session_refresh_500_when_no_secret(monkeypatch, client):
    monkeypatch.setattr("backend.config.settings.pat_session_secret", "")
    r = client.get("/session/refresh", params={"cookie": "abc"})
    assert r.status_code == 500
