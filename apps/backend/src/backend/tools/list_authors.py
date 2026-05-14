"""Tool: list_authors — returns all authors with basic metadata."""
from langchain_core.tools import tool

from ..db import conn


@tool
async def list_authors() -> list[dict]:
    """Список всех авторов с базовыми метаданными.

    Возвращает: список объектов {slug, name_display, years, century, global_section}.
    """
    async with conn() as c:
        cur = await c.execute(
            """
            SELECT slug, name_display, years, century, global_section
            FROM authors
            ORDER BY name_display
            """
        )
        rows = await cur.fetchall()
    return [
        {
            "slug": r[0],
            "name_display": r[1],
            "years": r[2],
            "century": r[3],
            "global_section": r[4],
        }
        for r in rows
    ]
