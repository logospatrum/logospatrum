"""Tool: list_authors — search authors by substring (or list all)."""
from langchain_core.tools import tool

from ..db import conn


@tool
async def list_authors(q: str | None = None, limit: int = 20) -> list[dict]:
    """Поиск авторов в корпусе по подстроке в имени или slug'е.

    Args:
        q: подстрока для фильтра (case-insensitive, ищет в name_display И slug).
            Пример: q="палама" → найдёт Григория Паламу.
            Если не передан — вернёт первых `limit` авторов по алфавиту (полный
            список — 86 авторов, дамп тяжёлый для контекста; используй q).
        limit: максимум результатов (default 20).

    Возвращает: список объектов {slug, name_display, years, century, global_section, work_count}.
    Если ничего не нашлось — пустой список. Перепробуй разные подстроки
    (фамилия, имя, ключевое слово из «лествица»/«златоуст»/«палама»).
    """
    where = ""
    params: list = []
    if q:
        where = "WHERE name_display ILIKE %s OR slug ILIKE %s"
        like = f"%{q}%"
        params = [like, like]
    params.append(limit)

    async with conn() as c:
        cur = await c.execute(
            f"""
            SELECT a.slug, a.name_display, a.years, a.century, a.global_section,
                   (SELECT COUNT(*) FROM works w WHERE w.author_slug = a.slug) AS work_count
            FROM authors a
            {where}
            ORDER BY a.name_display
            LIMIT %s
            """,
            params,
        )
        rows = await cur.fetchall()
    return [
        {
            "slug": r[0],
            "name_display": r[1],
            "years": r[2],
            "century": r[3],
            "global_section": r[4],
            "work_count": r[5],
        }
        for r in rows
    ]
