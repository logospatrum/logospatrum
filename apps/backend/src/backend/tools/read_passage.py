"""Tool: read_passage — exact text by canonical citation + context paragraphs."""
from langchain_core.tools import tool

from ..db import conn
from ._citation import parse_citation


@tool
async def read_passage(citation: str, context_n: int = 2) -> dict:
    """Возвращает точный текст абзаца(ев) по канонической ссылке + N абзацев контекста.

    Args:
        citation: канонический формат 'author/work/chapter/pX[-Y]'.
        context_n: число абзацев контекста до и после (≥0).

    На успехе: {found: true, text, context_before, context_after, author, work_title,
                chapter_num, chapter_title, para_start, window_size, source_url, citation}.

    На ошибке (некорректный формат или пассаж не найден): возвращает
    {found: false, error: <reason>, citation: <as given>}. Tool НЕ кидает
    исключение, чтобы один неудачный вызов не отменял другие параллельные.
    """
    try:
        parsed = parse_citation(citation)
    except (ValueError, IndexError) as e:
        return {
            "found": False,
            "error": f"bad citation format ({e}); expected 'author_slug/work_slug/chapter_num/pX[-Y]'",
            "citation": citation,
        }
    start = parsed["para_start"]
    end = start + parsed["window_size"] - 1

    async with conn() as c:
        cur = await c.execute(
            """
            SELECT p.para_num, p.text
            FROM paragraphs p
            WHERE p.work_slug=%s AND p.chapter_num=%s
              AND p.para_num BETWEEN %s AND %s
            ORDER BY p.para_num
            """,
            [parsed["work_slug"], parsed["chapter_num"], start, end],
        )
        main_rows = await cur.fetchall()
        if not main_rows:
            # Try to give the LLM a hint: does the work_slug exist at all?
            cur = await c.execute(
                "SELECT 1 FROM works WHERE slug=%s",
                [parsed["work_slug"]],
            )
            work_exists = bool(await cur.fetchone())
            hint = ("work_slug not found in corpus — likely a hallucinated/shortened "
                    "slug; copy the citation verbatim from search results"
                    if not work_exists else
                    "work exists but no paragraph at this chapter/para; check the numbers")
            return {
                "found": False,
                "error": f"passage not found: {citation}. {hint}",
                "citation": citation,
                "work_exists": work_exists,
            }

        cur = await c.execute(
            """
            SELECT text FROM paragraphs
            WHERE work_slug=%s AND chapter_num=%s
              AND para_num BETWEEN %s AND %s
            ORDER BY para_num
            """,
            [parsed["work_slug"], parsed["chapter_num"], max(1, start - context_n), start - 1],
        )
        before_rows = await cur.fetchall()

        cur = await c.execute(
            """
            SELECT text FROM paragraphs
            WHERE work_slug=%s AND chapter_num=%s
              AND para_num BETWEEN %s AND %s
            ORDER BY para_num
            """,
            [parsed["work_slug"], parsed["chapter_num"], end + 1, end + context_n],
        )
        after_rows = await cur.fetchall()

        cur = await c.execute(
            """
            SELECT a.name_display, w.title_display, w.source_url, ch.title
            FROM works w
            JOIN authors a ON a.slug = w.author_slug
            LEFT JOIN chapters ch ON ch.work_slug=w.slug AND ch.chapter_num=%s
            WHERE w.slug=%s
            """,
            [parsed["chapter_num"], parsed["work_slug"]],
        )
        meta = await cur.fetchone()

    return {
        "found": True,
        "text": "\n\n".join(r[1] for r in main_rows),
        "context_before": "\n\n".join(r[0] for r in before_rows),
        "context_after": "\n\n".join(r[0] for r in after_rows),
        "author": meta[0] if meta else None,
        "work_title": meta[1] if meta else None,
        "source_url": meta[2] if meta else None,
        "chapter_title": meta[3] if meta else None,
        "chapter_num": parsed["chapter_num"],
        "para_start": start,
        "window_size": parsed["window_size"],
        "citation": citation,
    }
