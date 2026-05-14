"""Markdown → paragraphs parsing + DB ingest.

Parsing is pure (testable). DB ingest is in `run()` function.
"""
import re
from pathlib import Path

from .models import ParsedMarkdown


MIN_PARA_CHARS = 30

_NOISE_PATTERNS = [
    re.compile(r"^—\s*\d+\s*—$"),          # — 42 —
    re.compile(r"^\*\d+\)?\s*$"),           # *1) or *1
    re.compile(r"^\s*\d+\s*$"),             # bare page number
    re.compile(r"^[\s\-=_]{1,}$"),          # dividers
]

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def _parse_frontmatter(raw: str) -> dict:
    out: dict = {}
    for line in raw.split("\n"):
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        out[key.strip()] = value.strip()
    return out


def _is_noise(line: str) -> bool:
    stripped = line.strip()
    if len(stripped) == 0:
        return True
    if len(stripped) < MIN_PARA_CHARS:
        return True
    for pat in _NOISE_PATTERNS:
        if pat.match(stripped):
            return True
    return False


def split_paragraphs(body: str) -> list[str]:
    """Split body into paragraphs.

    Prefers blank-line separators. Falls back to single-newline split if no
    blank lines exist. Filters noise (short blocks, page markers, footnote
    markers).
    """
    raw = re.split(r"\n{2,}", body)
    raw = [b.strip() for b in raw if b.strip()]
    if len(raw) == 1 and "\n" in raw[0]:
        raw = [line.strip() for line in raw[0].split("\n") if line.strip()]
    return [p for p in raw if not _is_noise(p)]


def parse_md(path: Path) -> ParsedMarkdown:
    """Parse a markdown file with YAML-ish frontmatter into ParsedMarkdown."""
    content = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(content)
    if m:
        frontmatter = _parse_frontmatter(m.group(1))
        body = m.group(2)
    else:
        frontmatter = {}
        body = content
    paragraphs = split_paragraphs(body)
    return ParsedMarkdown(frontmatter=frontmatter, body=body, paragraphs=paragraphs)


# === DB ingest (Task 10) ===

import json
from rich.progress import Progress

from .config import settings
from .db import init_pool, close_pool, conn
from .slugify import slugify


def _century_from_years(years: str | None) -> int | None:
    if not years:
        return None
    m = re.search(r"\d{3,4}", years)
    if not m:
        return None
    year = int(m.group())
    return (year - 1) // 100 + 1


def _chapter_num_from_filename(filename: str) -> int:
    m = re.match(r"^(\d+)_", filename)
    return int(m.group(1)) if m else 1


async def _upsert_author(c, slug: str, name: str, years: str | None, section: str | None) -> None:
    century = _century_from_years(years)
    await c.execute(
        """
        INSERT INTO authors (slug, name_display, years, century, global_section)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
        SET name_display=EXCLUDED.name_display,
            years=COALESCE(EXCLUDED.years, authors.years),
            century=COALESCE(EXCLUDED.century, authors.century),
            global_section=COALESCE(EXCLUDED.global_section, authors.global_section)
        """,
        [slug, name, years, century, section],
    )


async def _upsert_work(c, slug: str, author_slug: str, title: str,
                      creation_date: str | None, section: str | None,
                      source_url: str | None) -> None:
    await c.execute(
        """
        INSERT INTO works (slug, author_slug, title_display, creation_date, section, source_url)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
        SET title_display=EXCLUDED.title_display,
            creation_date=COALESCE(EXCLUDED.creation_date, works.creation_date),
            section=COALESCE(EXCLUDED.section, works.section),
            source_url=COALESCE(EXCLUDED.source_url, works.source_url)
        """,
        [slug, author_slug, title, creation_date, section, source_url],
    )


async def _upsert_chapter(c, work_slug: str, chapter_num: int,
                          title: str | None, source_md_path: str) -> None:
    await c.execute(
        """
        INSERT INTO chapters (work_slug, chapter_num, title, source_md_path)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (work_slug, chapter_num) DO UPDATE
        SET title=EXCLUDED.title,
            source_md_path=EXCLUDED.source_md_path
        """,
        [work_slug, chapter_num, title, source_md_path],
    )


async def _replace_paragraphs(c, work_slug: str, chapter_num: int,
                              paragraphs: list[str], body: str) -> None:
    await c.execute(
        "DELETE FROM paragraphs WHERE work_slug=%s AND chapter_num=%s",
        [work_slug, chapter_num],
    )
    offsets = []
    pos = 0
    for p in paragraphs:
        idx = body.find(p, pos)
        if idx < 0:
            offsets.append((0, len(p)))
        else:
            offsets.append((idx, idx + len(p)))
            pos = idx + len(p)
    rows = [
        (work_slug, chapter_num, i + 1, p, off[0], off[1])
        for i, (p, off) in enumerate(zip(paragraphs, offsets))
    ]
    if rows:
        async with c.cursor() as cur:
            await cur.executemany(
                """
                INSERT INTO paragraphs
                    (work_slug, chapter_num, para_num, text,
                     char_offset_start, char_offset_end)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )


async def run() -> None:
    await init_pool()
    md_files = list(settings.output_dir.rglob("*.md"))
    print(f"Found {len(md_files)} md files in {settings.output_dir}")

    work_para_counts: dict[str, int] = {}

    with Progress() as progress:
        task = progress.add_task("Parsing md", total=len(md_files))
        async with conn() as c:
            async with c.transaction():
                for path in md_files:
                    progress.update(task, advance=1)
                    try:
                        parsed = parse_md(path)
                    except Exception as e:
                        print(f"  [skip] {path}: {e}")
                        continue

                    fm = parsed.frontmatter
                    author_name = fm.get("author", "").strip()
                    work_title = fm.get("book_title", "").strip()
                    if not author_name or not work_title:
                        continue

                    chapter_title = fm.get("chapter_title")
                    try:
                        chapter_num = int(fm.get("chapter_number") or _chapter_num_from_filename(path.name))
                    except ValueError:
                        chapter_num = _chapter_num_from_filename(path.name)

                    author_slug = slugify(author_name)
                    work_slug = slugify(f"{author_slug}_{work_title}")
                    rel_path = str(path.relative_to(settings.output_dir))

                    await _upsert_author(c, author_slug, author_name,
                                         fm.get("author_years_of_life"),
                                         fm.get("global_section"))
                    await _upsert_work(c, work_slug, author_slug, work_title,
                                       fm.get("creation_date"),
                                       fm.get("section"),
                                       fm.get("source_url"))
                    await _upsert_chapter(c, work_slug, chapter_num, chapter_title, rel_path)
                    await _replace_paragraphs(c, work_slug, chapter_num,
                                              parsed.paragraphs, parsed.body)

                    work_para_counts[work_slug] = work_para_counts.get(work_slug, 0) + len(parsed.paragraphs)

                for ws, count in work_para_counts.items():
                    await c.execute(
                        "UPDATE works SET paragraph_count=%s WHERE slug=%s",
                        [count, ws],
                    )

    await close_pool()
    print(f"Indexed {sum(work_para_counts.values())} paragraphs across {len(work_para_counts)} works.")
