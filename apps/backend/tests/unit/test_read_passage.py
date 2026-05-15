import pytest
from backend.tools.read_passage import read_passage


@pytest.mark.asyncio
async def test_read_passage_returns_exact_text(db_with_paragraphs):
    result = await read_passage.ainvoke({
        "citation": "lestvichnik/lestvichnik_lestvica/0004/p1",
        "context_n": 0,
    })
    assert "Послушание есть совершенное отречение" in result["text"]
    assert result["author"] == "Иоанн Лествичник, преподобный"
    assert result["work_title"] == "Лествица"
    assert result["chapter_num"] == 4
    assert result["source_url"].startswith("https://azbyka.ru")


@pytest.mark.asyncio
async def test_read_passage_window_range(db_with_paragraphs):
    result = await read_passage.ainvoke({
        "citation": "lestvichnik/lestvichnik_lestvica/0004/p1-2",
        "context_n": 0,
    })
    assert "Послушание есть" in result["text"]
    assert "Послушник тот" in result["text"]


@pytest.mark.asyncio
async def test_read_passage_with_context(db_with_paragraphs):
    result = await read_passage.ainvoke({
        "citation": "lestvichnik/lestvichnik_lestvica/0004/p2",
        "context_n": 1,
    })
    assert "Послушание есть" in result["context_before"]
    assert "Послушник тот" in result["text"]
    assert result["context_after"] == ""


@pytest.mark.asyncio
async def test_read_passage_unknown_citation_returns_structured_fail(db_with_paragraphs):
    """Tool must NOT raise — one bad citation in a parallel batch would
    cancel sibling calls (langgraph cancel-on-failure). It returns
    {found: false, error: ...} so the agent can recover."""
    result = await read_passage.ainvoke({
        "citation": "fake/fake_work/0001/p1",
        "context_n": 0,
    })
    assert result["found"] is False
    assert "fake/fake_work" in result["error"]
    assert result["work_exists"] is False


@pytest.mark.asyncio
async def test_read_passage_bad_format_returns_structured_fail(db_with_paragraphs):
    """Malformed citation also returns structured fail (not raise)."""
    result = await read_passage.ainvoke({
        "citation": "garbage",
        "context_n": 0,
    })
    assert result["found"] is False
    assert "bad citation format" in result["error"]
