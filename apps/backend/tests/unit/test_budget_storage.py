import pytest
from backend.budget import storage


@pytest.mark.asyncio
async def test_get_returns_zero_when_absent(db_clean):
    used = await storage.get_used_rub("cookie:abc", "2026-05-17")
    assert used == 0.0


@pytest.mark.asyncio
async def test_add_inserts_first_time(db_clean):
    after = await storage.add_usage("cookie:abc", "2026-05-17", 12.34)
    assert after == pytest.approx(12.34)
    used = await storage.get_used_rub("cookie:abc", "2026-05-17")
    assert used == pytest.approx(12.34)


@pytest.mark.asyncio
async def test_add_upserts_on_repeat(db_clean):
    await storage.add_usage("cookie:abc", "2026-05-17", 10.0)
    after = await storage.add_usage("cookie:abc", "2026-05-17", 5.5)
    assert after == pytest.approx(15.5)


@pytest.mark.asyncio
async def test_keys_are_isolated_per_subject_and_bucket(db_clean):
    await storage.add_usage("cookie:a", "2026-05-17", 100.0)
    await storage.add_usage("cookie:b", "2026-05-17", 200.0)
    await storage.add_usage("cookie:a", "2026-05-18", 50.0)
    assert await storage.get_used_rub("cookie:a", "2026-05-17") == pytest.approx(100.0)
    assert await storage.get_used_rub("cookie:b", "2026-05-17") == pytest.approx(200.0)
    assert await storage.get_used_rub("cookie:a", "2026-05-18") == pytest.approx(50.0)


def test_today_msk_format():
    today = storage._today_msk()
    assert len(today) == 10 and today[4] == "-" and today[7] == "-"


def test_this_month_msk_format():
    month = storage._this_month_msk()
    assert len(month) == 7 and month[4] == "-"
