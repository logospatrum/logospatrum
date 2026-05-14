"""Tool: list_works — works by author."""
import json
from langchain_core.tools import tool

from ..db import conn


@tool
async def list_works(author_slug: str) -> list[dict]:
    """Список трудов автора.

    Args:
        author_slug: канонический slug автора (из list_authors).

    Возвращает список {slug, title_display, creation_date, section, source_url, topics, paragraph_count}.
    """
    async with conn() as c:
        cur = await c.execute(
            """
            SELECT slug, title_display, creation_date, section, source_url, topics, paragraph_count
            FROM works
            WHERE author_slug = %s
            ORDER BY title_display
            """,
            [author_slug],
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
