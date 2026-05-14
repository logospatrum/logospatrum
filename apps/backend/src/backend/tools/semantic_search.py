"""Tool: semantic_search — bge-m3 + pgvector ANN with optional filters."""
from langchain_core.tools import tool

from ..db import conn
from ..embeddings import get_service
from ._citation import make_citation


def _get_service():
    return get_service()


@tool
async def semantic_search(
    query: str,
    author_slug: str | None = None,
    work_slug: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Семантический поиск через эмбеддинги.

    Args:
        query: текст запроса.
        author_slug: фильтр по автору.
        work_slug: фильтр по труду.
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    if not query.strip():
        return []

    svc = _get_service()
    await svc.start()
    vec = await svc.embed(query)

    filters = []
    where_params: list = []
    if author_slug:
        filters.append("w.author_slug = %s")
        where_params.append(author_slug)
    if work_slug:
        filters.append("e.work_slug = %s")
        where_params.append(work_slug)
    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    sql = f"""
        SELECT w.author_slug, e.work_slug, e.chapter_num, e.para_num, e.window_size,
               LEFT(p.text, 200) AS snippet,
               1 - (e.vector <=> %s::vector) AS score
        FROM embeddings e
        JOIN works w ON w.slug = e.work_slug
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
