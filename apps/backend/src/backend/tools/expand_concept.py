"""Tool: expand_concept — reads glossary.json, returns concept expansion."""
import json
from pathlib import Path
from langchain_core.tools import tool

from ..config import settings


GLOSSARY_PATH: Path = settings.glossary_path
_cache: dict | None = None


def _load() -> dict:
    global _cache
    if _cache is None:
        if not GLOSSARY_PATH.exists():
            _cache = {"concepts": {}}
        else:
            _cache = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    return _cache


@tool
async def expand_concept(term: str) -> dict:
    """Расширяет концепт: возвращает синонимы, связанные, антонимы, греческие термины.

    Args:
        term: концепт на русском.

    Возвращает:
        {found: bool, canonical, synonyms, related, antonyms, greek}
        Если не найден — {found: False, suggestions: [близкие из словаря]}.
    """
    data = _load()
    concepts: dict[str, dict] = data.get("concepts", {})

    key = next((k for k in concepts if k.lower() == term.lower()), None)
    if key:
        entry = concepts[key]
        return {
            "found": True,
            "canonical": entry["canonical"],
            "synonyms": entry["synonyms"],
            "related": entry["related"],
            "antonyms": entry["antonyms"],
            "greek": entry["greek"],
        }

    suggestions = [k for k in concepts if term.lower() in k.lower() or k.lower() in term.lower()][:5]
    return {"found": False, "suggestions": suggestions}
