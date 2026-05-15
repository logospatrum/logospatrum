import pytest
from backend.tools.list_authors import list_authors


@pytest.mark.asyncio
async def test_list_authors_returns_all(db_with_seed_authors):
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
