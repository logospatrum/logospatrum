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


@pytest.mark.asyncio
async def test_lexical_search_author_slug_accepts_list(db_with_paragraphs):
    # Seed has 3 authors: avgustin, lestvichnik, platon — only lestvichnik
    # has paragraphs / embeddings, but passing the multi-slug list must still
    # narrow correctly (lestvichnik wins, platon and avgustin add no rows).
    result = await lexical_search.ainvoke({
        "query": "отречение",
        "author_slug": ["lestvichnik", "platon", "avgustin"],
    })
    assert len(result) >= 1
    for r in result:
        assert r["work_slug"].startswith("lestvichnik_")


@pytest.mark.asyncio
async def test_lexical_search_work_slug_accepts_list(db_with_paragraphs):
    result = await lexical_search.ainvoke({
        "query": "отречение",
        "work_slug": ["lestvichnik_lestvica", "no_such_work"],
    })
    for r in result:
        assert r["work_slug"] == "lestvichnik_lestvica"


@pytest.mark.asyncio
async def test_lexical_search_empty_slug_list_disables_filter(db_with_paragraphs):
    # Empty list MUST behave like None (no filter), not "match nothing".
    a = await lexical_search.ainvoke({"query": "отречение"})
    b = await lexical_search.ainvoke({"query": "отречение", "author_slug": []})
    assert {r["citation"] for r in a} == {r["citation"] for r in b}


@pytest.mark.asyncio
async def test_lexical_search_section_alias_patristic(db_with_paragraphs):
    # Seed authors are all under "Православная библиотека" — alias "patristic"
    # must resolve to that and return matches.
    result = await lexical_search.ainvoke({
        "query": "отречение",
        "section": "patristic",
    })
    assert len(result) >= 1


@pytest.mark.asyncio
async def test_lexical_search_section_alias_bible_excludes_patristic(db_with_paragraphs):
    # No Bible content seeded -> alias "bible" must filter everything out.
    result = await lexical_search.ainvoke({
        "query": "отречение",
        "section": "bible",
    })
    assert result == []
