"""Tool: lexical_search — Postgres tsvector + ts_rank, with optional filters."""
import json
import re
from functools import lru_cache
from pathlib import Path

from langchain_core.tools import tool

from ..config import settings
from ..db import conn
from ._citation import make_citation


_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")


@lru_cache(maxsize=1)
def _cs_dict() -> dict[str, str]:
    if settings.cs_dict_path.exists():
        return json.loads(settings.cs_dict_path.read_text(encoding="utf-8"))
    return {}


def _preprocess(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    text = _PUNCT.sub(" ", text)
    text = _WS.sub(" ", text).strip()
    cs = _cs_dict()
    if cs:
        text = " ".join(cs.get(t, t) for t in text.split())
    return text


@tool
async def lexical_search(
    query: str,
    author_slug: str | None = None,
    work_slug: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Лексический поиск (tsvector + ts_rank) с опциональными фильтрами.

    Args:
        query: текст запроса.
        author_slug: фильтр по автору.
        work_slug: фильтр по труду.
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    q = _preprocess(query)
    if not q:
        return []

    filters = []
    params: list = [q, q]
    if author_slug:
        filters.append("w.author_slug = %s")
        params.append(author_slug)
    if work_slug:
        filters.append("e.work_slug = %s")
        params.append(work_slug)
    where_extra = (" AND " + " AND ".join(filters)) if filters else ""
    params.append(limit)

    sql = f"""
        SELECT w.author_slug, e.work_slug, e.chapter_num, e.para_num, e.window_size,
               LEFT(p.text, 200) AS snippet,
               ts_rank(e.text_for_lexical, plainto_tsquery('russian', %s)) AS score
        FROM embeddings e
        JOIN works w ON w.slug = e.work_slug
        JOIN paragraphs p ON p.work_slug = e.work_slug
            AND p.chapter_num = e.chapter_num
            AND p.para_num = e.para_num
        WHERE e.text_for_lexical @@ plainto_tsquery('russian', %s){where_extra}
        ORDER BY score DESC
        LIMIT %s
    """

    async with conn() as c:
        cur = await c.execute(sql, params)
        rows = await cur.fetchall()

    return [
        {
            "citation": make_citation(r[0], r[1], r[2], r[3], r[4]),
            "work_slug": r[1],
            "chapter_num": r[2],
            "para_num": r[3],
            "window_size": r[4],
            "snippet": r[5],
            "score": float(r[6]),
        }
        for r in rows
    ]
