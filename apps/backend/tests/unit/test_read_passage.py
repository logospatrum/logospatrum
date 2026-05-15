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
async def test_read_passage_unknown_citation_raises(db_with_paragraphs):
    with pytest.raises(Exception):
        await read_passage.ainvoke({
            "citation": "fake/fake_work/0001/p1",
            "context_n": 0,
        })
