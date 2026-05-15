import pytest
from backend.tools.list_authors import list_authors


@pytest.mark.asyncio
async def test_list_authors_returns_all_when_no_q(db_with_seed_authors):
    result = await list_authors.ainvoke({})
    assert len(result) == 3
    slugs = {a["slug"] for a in result}
    assert slugs == {"avgustin", "lestvichnik", "platon"}


@pytest.mark.asyncio
async def test_list_authors_includes_metadata(db_with_seed_authors):
    result = await list_authors.ainvoke({})
    avg = next(a for a in result if a["slug"] == "avgustin")
    assert avg["name_display"] == "Аврелий Августин, блаженный"
    assert avg["years"] == "(354–430)"
    assert avg["century"] == 5
    assert avg["work_count"] == 1


@pytest.mark.asyncio
async def test_list_authors_filters_by_q_in_name(db_with_seed_authors):
    result = await list_authors.ainvoke({"q": "Августин"})
    assert len(result) == 1
    assert result[0]["slug"] == "avgustin"


@pytest.mark.asyncio
async def test_list_authors_q_is_case_insensitive(db_with_seed_authors):
    result = await list_authors.ainvoke({"q": "ПЛАТОН"})
    assert len(result) == 1
    assert result[0]["slug"] == "platon"


@pytest.mark.asyncio
async def test_list_authors_q_matches_slug(db_with_seed_authors):
    result = await list_authors.ainvoke({"q": "lestvichnik"})
    assert len(result) == 1
    assert result[0]["slug"] == "lestvichnik"


@pytest.mark.asyncio
async def test_list_authors_q_returns_empty_on_miss(db_with_seed_authors):
    result = await list_authors.ainvoke({"q": "нетвкорпусе"})
    assert result == []


@pytest.mark.asyncio
async def test_list_authors_respects_limit(db_with_seed_authors):
    result = await list_authors.ainvoke({"limit": 2})
    assert len(result) == 2
