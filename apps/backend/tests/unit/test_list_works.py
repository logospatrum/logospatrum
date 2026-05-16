import pytest
from backend.tools.list_works import list_works


@pytest.mark.asyncio
async def test_list_works_for_author(db_with_seed_authors):
    result = await list_works.ainvoke({"author_slug": "avgustin"})
    assert len(result) == 1
    w = result[0]
    assert w["slug"] == "avgustin_ispoved"
    assert w["title_display"] == "Исповедь"
    assert w["source_url"].startswith("https://azbyka.ru")
    assert w["paragraph_count"] == 412


@pytest.mark.asyncio
async def test_list_works_unknown_author_returns_empty(db_with_seed_authors):
    result = await list_works.ainvoke({"author_slug": "no_such_author"})
    assert result == []


@pytest.mark.asyncio
async def test_list_works_for_philosophy_author(db_with_seed_authors):
    result = await list_works.ainvoke({"author_slug": "platon"})
    assert len(result) == 1
    assert result[0]["slug"] == "platon_gosudarstvo"


@pytest.mark.asyncio
async def test_list_works_filters_by_q_in_title(db_with_seed_authors):
    """q filters by title_display substring case-insensitively."""
    # Seed has 'Исповедь' for avgustin
    hit = await list_works.ainvoke({"author_slug": "avgustin", "q": "исповедь"})
    assert len(hit) == 1
    assert hit[0]["slug"] == "avgustin_ispoved"
    miss = await list_works.ainvoke({"author_slug": "avgustin", "q": "нетвкорпусе"})
    assert miss == []


@pytest.mark.asyncio
async def test_list_works_respects_limit(db_with_seed_authors):
    """limit caps results."""
    result = await list_works.ainvoke({"author_slug": "avgustin", "limit": 0})
    assert result == []
