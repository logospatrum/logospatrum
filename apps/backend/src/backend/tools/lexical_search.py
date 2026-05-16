"""Tool: lexical_search — Postgres tsvector + ts_rank, with optional filters."""
import asyncio
import json
import re

from langchain_core.tools import tool

from ..config import settings
from ..db import conn
from ._citation import make_citation
from ._filters import resolve_section, slug_filter_sql


_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")

# Lazy-loaded once, then served from RAM. The file read + JSON parse run in
# a worker thread so the event loop never blocks (blockbuster catches sync
# I/O on the main thread and fails the run; ditching --allow-blocking
# requires this).
_cs_dict_cache: dict[str, str] | None = None
_cs_dict_lock = asyncio.Lock()


def _cs_dict_sync() -> dict[str, str]:
    """Pure sync load; called only via asyncio.to_thread."""
    if settings.cs_dict_path.exists():
        return json.loads(settings.cs_dict_path.read_text(encoding="utf-8"))
    return {}


async def _cs_dict() -> dict[str, str]:
    global _cs_dict_cache
    if _cs_dict_cache is not None:
        return _cs_dict_cache
    async with _cs_dict_lock:
        if _cs_dict_cache is not None:
            return _cs_dict_cache
        _cs_dict_cache = await asyncio.to_thread(_cs_dict_sync)
    return _cs_dict_cache


async def _preprocess(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    text = _PUNCT.sub(" ", text)
    text = _WS.sub(" ", text).strip()
    cs = await _cs_dict()
    if cs:
        text = " ".join(cs.get(t, t) for t in text.split())
    return text


@tool
async def lexical_search(
    query: str,
    author_slug: str | list[str] | None = None,
    work_slug: str | list[str] | None = None,
    section: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Лексический поиск (tsvector + ts_rank) с опциональными фильтрами.

    Args:
        query: текст запроса.
        author_slug: один slug или список slug'ов — ищет у указанного(ых) автора(ов).
            Передавай list[str], если хочешь искать у нескольких авторов сразу
            (один SQL-проход вместо N — экономит круговой обход к БД).
        work_slug: один slug или список slug'ов — фильтр по труду(ам).
        section: фильтр по корпусу: "bible" / "scripture" → только Писание;
            "patristic" / "fathers" → только патристика. Алиасы кириллические тоже
            работают ("писание", "патристика"). Точное значение global_section
            тоже принимается. Используй, например, в negative-сценарии: чтобы
            подтвердить, что термин «вне Писания», ищи только в section="bible".
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    q = await _preprocess(query)
    if not q:
        return []

    # When filtering by author or section the naive plan nested-loops 300+
    # inner Bitmap Heap Scans (one per matching work) and takes ~2.4s on
    # multi-author cross queries. Materializing the eligible work_slug list
    # into a CTE forces the planner into a single BitmapAnd between the
    # GIN(text_for_lexical) index and the small CTE join — drops latency
    # to ~200-400ms. work_slug filter alone doesn't need the CTE (already
    # a tight set on a primary-key prefix).
    use_wlist = bool(author_slug) or bool(section)

    sql_parts: list[str] = []
    all_params: list = []

    if use_wlist:
        cte_filters: list[str] = []
        cte_params: list = []
        a_sql, a_params = slug_filter_sql("w.author_slug", author_slug)
        if a_sql:
            cte_filters.append(a_sql)
            cte_params.extend(a_params)
        if section:
            cte_filters.append("a.global_section = %s")
            cte_params.append(resolve_section(section))
        sql_parts.append(
            "WITH wlist AS MATERIALIZED (\n"
            "  SELECT w.slug FROM works w\n"
            "  JOIN authors a ON a.slug = w.author_slug\n"
            f"  WHERE {' AND '.join(cte_filters)}\n"
            ")"
        )
        all_params.extend(cte_params)

    # Main query params: q twice (ts_rank + tsquery in WHERE).
    all_params.extend([q, q])

    extra_filters: list[str] = []
    w_sql, w_params = slug_filter_sql("e.work_slug", work_slug)
    if w_sql:
        extra_filters.append(w_sql)
        all_params.extend(w_params)
    where_extra = (" AND " + " AND ".join(extra_filters)) if extra_filters else ""
    all_params.append(limit)

    join_wlist = "JOIN wlist ON wlist.slug = e.work_slug" if use_wlist else ""

    sql_parts.append(f"""
        SELECT w.author_slug, e.work_slug, e.chapter_num, e.para_num, e.window_size,
               LEFT(p.text, 200) AS snippet,
               ts_rank(e.text_for_lexical, plainto_tsquery('russian', %s)) AS score
        FROM embeddings e
        {join_wlist}
        JOIN works w ON w.slug = e.work_slug
        JOIN paragraphs p ON p.work_slug = e.work_slug
            AND p.chapter_num = e.chapter_num
            AND p.para_num = e.para_num
        WHERE e.text_for_lexical @@ plainto_tsquery('russian', %s){where_extra}
        ORDER BY score DESC
        LIMIT %s
    """)

    sql = "\n".join(sql_parts)

    async with conn() as c:
        cur = await c.execute(sql, all_params)
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
