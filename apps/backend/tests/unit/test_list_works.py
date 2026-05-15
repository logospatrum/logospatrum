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
