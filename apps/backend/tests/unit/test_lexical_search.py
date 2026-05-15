import pytest
from backend.tools.lexical_search import lexical_search


@pytest.mark.asyncio
async def test_lexical_search_finds_obvious(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "послушание"})
    assert len(result) >= 1
    top = result[0]
    assert top["work_slug"] == "lestvichnik_lestvica"
    assert top["chapter_num"] == 4


@pytest.mark.asyncio
async def test_lexical_search_filter_by_author(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "отречение", "author_slug": "lestvichnik"})
    assert len(result) >= 1
    for r in result:
        assert r["work_slug"].startswith("lestvichnik_")


@pytest.mark.asyncio
async def test_lexical_search_filter_by_work(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "отречение", "work_slug": "lestvichnik_lestvica"})
    for r in result:
        assert r["work_slug"] == "lestvichnik_lestvica"


@pytest.mark.asyncio
async def test_lexical_search_returns_canonical_citation(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "послушание"})
    top = result[0]
    assert "citation" in top
    assert top["citation"].startswith("lestvichnik/lestvichnik_lestvica/")
    assert "/p" in top["citation"]


@pytest.mark.asyncio
async def test_lexical_search_respects_limit(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "отречение", "limit": 1})
    assert len(result) == 1
