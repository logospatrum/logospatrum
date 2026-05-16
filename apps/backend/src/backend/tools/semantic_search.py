"""Tool: semantic_search — bge-m3 + pgvector ANN with optional filters."""
from langchain_core.tools import tool

from ..db import conn
from ..embeddings import get_service
from ._citation import make_citation
from ._filters import resolve_section, slug_filter_sql


def _get_service():
    return get_service()


@tool
async def semantic_search(
    query: str,
    author_slug: str | list[str] | None = None,
    work_slug: str | list[str] | None = None,
    section: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Семантический поиск через эмбеддинги (bge-m3 + pgvector HNSW).

    Args:
        query: текст запроса.
        author_slug: один slug или список slug'ов — ищет у указанного(ых) автора(ов).
            Передавай list[str], если хочешь искать у нескольких авторов сразу:
            **один эмбеддинг запроса** + один SQL-проход. Это драматически дешевле,
            чем N отдельных вызовов с одним автором.
        work_slug: один slug или список slug'ов — фильтр по труду(ам).
        section: фильтр по корпусу: "bible" / "scripture" → только Писание;
            "patristic" / "fathers" → только патристика. Алиасы кириллические тоже
            работают ("писание", "патристика"). Точное значение global_section
            тоже принимается.
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    if not query.strip():
        return []

    svc = _get_service()
    await svc.start()
    vec = await svc.embed(query)

    filters: list[str] = []
    where_params: list = []

    a_sql, a_params = slug_filter_sql("w.author_slug", author_slug)
    if a_sql:
        filters.append(a_sql)
        where_params.extend(a_params)

    w_sql, w_params = slug_filter_sql("e.work_slug", work_slug)
    if w_sql:
        filters.append(w_sql)
        where_params.extend(w_params)

    if section:
        filters.append("a.global_section = %s")
        where_params.append(resolve_section(section))

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    sql = f"""
        SELECT w.author_slug, e.work_slug, e.chapter_num, e.para_num, e.window_size,
               LEFT(p.text, 200) AS snippet,
               1 - (e.vector <=> %s::vector) AS score
        FROM embeddings e
        JOIN works w ON w.slug = e.work_slug
        JOIN authors a ON a.slug = w.author_slug
        JOIN paragraphs p ON p.work_slug=e.work_slug AND p.chapter_num=e.chapter_num AND p.para_num=e.para_num
        {where}
        ORDER BY e.vector <=> %s::vector
        LIMIT %s
    """
    params = [vec] + where_params + [vec, limit]

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
