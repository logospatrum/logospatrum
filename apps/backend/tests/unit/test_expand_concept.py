import json
import pytest


@pytest.fixture(autouse=True)
def patch_glossary(monkeypatch, tmp_path):
    glossary = {
        "concepts": {
            "гордость": {
                "canonical": "гордость",
                "synonyms": ["превозношение", "кичение", "высокоумие"],
                "related": ["тщеславие", "самомнение"],
                "antonyms": ["смирение"],
                "greek": ["ὑπερηφανία", "οἴησις"],
            },
            "молитва Иисусова": {
                "canonical": "молитва Иисусова",
                "synonyms": ["умная молитва", "сердечная молитва"],
                "related": ["трезвение", "исихия"],
                "antonyms": [],
                "greek": ["νοερὰ προσευχή"],
            },
        }
    }
    path = tmp_path / "glossary.json"
    path.write_text(json.dumps(glossary, ensure_ascii=False), encoding="utf-8")
    from backend.tools import expand_concept as ec
    monkeypatch.setattr(ec, "GLOSSARY_PATH", path)
    ec._cache = None


@pytest.mark.asyncio
async def test_expand_known_concept():
    from backend.tools.expand_concept import expand_concept
    result = await expand_concept.ainvoke({"term": "гордость"})
    assert result["found"] is True
    assert "превозношение" in result["synonyms"]
    assert "ὑπερηφανία" in result["greek"]
    assert "смирение" in result["antonyms"]


@pytest.mark.asyncio
async def test_expand_case_insensitive():
    from backend.tools.expand_concept import expand_concept
    result = await expand_concept.ainvoke({"term": "ГОРДОСТЬ"})
    assert result["found"] is True


@pytest.mark.asyncio
async def test_expand_unknown_returns_not_found():
    from backend.tools.expand_concept import expand_concept
    result = await expand_concept.ainvoke({"term": "неизвестный_концепт_xyz"})
    assert result["found"] is False
    assert "suggestions" in result
