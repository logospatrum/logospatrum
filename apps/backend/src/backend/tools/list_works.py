"""Tool: list_works — works by author with optional substring filter."""
import json
from langchain_core.tools import tool

from ..db import conn


@tool
async def list_works(author_slug: str, q: str | None = None, limit: int = 30) -> list[dict]:
    """Поиск трудов автора по подстроке в названии (или дамп с лимитом).

    Args:
        author_slug: канонический slug автора (из list_authors).
        q: подстрока для фильтра по `title_display` (case-insensitive).
            Пример: q="лествица" сузит выдачу до одного труда у соответствующего автора.
            У крупных авторов (Иоанн Златоуст — 154 труда, Феофан Затворник — 81) дамп
            без `q` тяжёлый (~20-30 KB). Всегда передавай `q`, если знаешь хотя бы часть
            названия.
        limit: максимум результатов (default 30).

    Возвращает список {slug, title_display, creation_date, section, source_url,
                       topics, paragraph_count}. Если ничего не нашлось — пустой список.
    """
    where_parts = ["author_slug = %s"]
    params: list = [author_slug]
    if q:
        where_parts.append("title_display ILIKE %s")
        params.append(f"%{q}%")
    params.append(limit)
    where = " AND ".join(where_parts)

    async with conn() as c:
        cur = await c.execute(
            f"""
            SELECT slug, title_display, creation_date, section, source_url, topics, paragraph_count
            FROM works
            WHERE {where}
            ORDER BY title_display
            LIMIT %s
            """,
            params,
        )
        rows = await cur.fetchall()
    return [
        {
            "slug": r[0],
            "title_display": r[1],
            "creation_date": r[2],
            "section": r[3],
            "source_url": r[4],
            "topics": (json.loads(r[5]) if isinstance(r[5], str) else r[5]) or [],
            "paragraph_count": r[6],
        }
        for r in rows
    ]
