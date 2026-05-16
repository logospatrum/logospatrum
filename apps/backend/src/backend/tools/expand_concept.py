"""Tool: expand_concept — reads glossary.json, returns concept expansion."""
import asyncio
import json
from pathlib import Path
from langchain_core.tools import tool

from ..config import settings


GLOSSARY_PATH: Path = settings.glossary_path
_cache: dict | None = None
_load_lock = asyncio.Lock()


def _load_sync() -> dict:
    """Pure sync load; called only via asyncio.to_thread."""
    if not GLOSSARY_PATH.exists():
        return {"concepts": {}}
    return json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))


async def _load() -> dict:
    """Async glossary loader, cached after first call.

    File read + JSON parse happen in a worker thread (asyncio.to_thread)
    so they don't block the event loop. Async lock serialises concurrent
    cold-cache callers — without it, N parallel first-time tool calls would
    each kick off a thread.
    """
    global _cache
    if _cache is not None:
        return _cache
    async with _load_lock:
        if _cache is not None:
            return _cache
        _cache = await asyncio.to_thread(_load_sync)
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
    data = await _load()
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
