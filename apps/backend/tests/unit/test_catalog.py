import pytest
from httpx import AsyncClient, ASGITransport
from backend.catalog import app


@pytest.mark.asyncio
async def test_catalog_returns_authors_with_works(db_with_seed_authors):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/catalog")
    assert resp.status_code == 200
    data = resp.json()
    authors = {a["slug"]: a for a in data["authors"]}
    assert "avgustin" in authors
    assert "platon" in authors
    avg = authors["avgustin"]
    assert avg["years"] == "(354–430)"
    titles = [w["title"] for w in avg["works"]]
    assert "Исповедь" in titles


@pytest.mark.asyncio
async def test_catalog_includes_source_url(db_with_seed_authors):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/catalog")
    avg = next(a for a in resp.json()["authors"] if a["slug"] == "avgustin")
    assert avg["works"][0]["source_url"].startswith("https://azbyka.ru")
