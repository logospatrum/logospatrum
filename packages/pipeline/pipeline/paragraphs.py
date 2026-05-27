"""Markdown → paragraphs parsing + DB ingest.

Parsing is pure (testable). DB ingest is in `run()` function.
"""
import re
from pathlib import Path

from .models import ParsedMarkdown


MIN_PARA_CHARS = 30

# Max chars per stored paragraph. Long source paragraphs are sub-split on
# sentence boundaries before insertion. 1500 chars ≈ 430 Russian tokens; a
# ws=3 window (three such pieces) fits inside cap=2048 with margin. Without
# this split, ~3% of MDs are single-paragraph monoliths up to 50K chars,
# which bge-m3 truncates at the seq cap — entire tails go unindexed.
MAX_PARA_CHARS = 1500

_NOISE_PATTERNS = [
    re.compile(r"^—\s*\d+\s*—$"),          # — 42 —
    re.compile(r"^\*\d+\)?\s*$"),           # *1) or *1
    re.compile(r"^\s*\d+\s*$"),             # bare page number
    re.compile(r"^[\s\-=_]{1,}$"),          # dividers
]

# Russian sentence terminators followed by whitespace + capital letter or
# digit. Includes the elongated ellipsis "…" and the angle quotes that
# patristic editors love to use.
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?…»])\s+(?=[А-ЯA-Z0-9«—])")

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


def _split_long_paragraph(text: str, max_chars: int = MAX_PARA_CHARS) -> list[str]:
    """Greedy-split an over-long paragraph on Russian sentence boundaries.

    Goal: keep every output sub-paragraph at or below `max_chars`. The
    `_SENTENCE_BOUNDARY_RE` lookahead requires a Cyrillic/Latin uppercase or
    digit start, so it ignores in-sentence abbreviations like "св. Иоанн".

    If a single sentence is itself longer than `max_chars` (e.g. monolithic
    epub paragraphs with no sentence breaks), the chunk is hard-cut on a
    word boundary near the limit. We never emit a sub-paragraph below
    MIN_PARA_CHARS — those merge into the next chunk.
    """
    if len(text) <= max_chars:
        return [text]

    sentences = _SENTENCE_BOUNDARY_RE.split(text)

    chunks: list[str] = []
    current = ""
    for s in sentences:
        if not s:
            continue
        candidate = (current + " " + s).strip() if current else s
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            # The single sentence itself is too long → hard-cut on word
            # boundaries.
            while len(s) > max_chars:
                cut = s.rfind(" ", 0, max_chars)
                if cut <= 0:
                    cut = max_chars
                chunks.append(s[:cut].strip())
                s = s[cut:].lstrip()
            current = s
    if current:
        chunks.append(current)
    # Drop fragments under MIN_PARA_CHARS by merging into previous (rare;
    # mostly happens after a trailing partial sentence after hard-cut).
    merged: list[str] = []
    for c in chunks:
        if c and len(c) < MIN_PARA_CHARS and merged:
            merged[-1] = (merged[-1] + " " + c).strip()
        else:
            merged.append(c)
    return [c for c in merged if c]


def split_paragraphs(body: str) -> list[str]:
    """Split body into paragraphs.

    Prefers blank-line separators. Falls back to single-newline split if no
    blank lines exist. Filters noise (short blocks, page markers, footnote
    markers). Sub-splits over-long paragraphs on sentence boundaries so the
    embedding model never silently truncates the tail.
    """
    raw = re.split(r"\n{2,}", body)
    raw = [b.strip() for b in raw if b.strip()]
    if len(raw) == 1 and "\n" in raw[0]:
        raw = [line.strip() for line in raw[0].split("\n") if line.strip()]
    filtered = [p for p in raw if not _is_noise(p)]
    out: list[str] = []
    for p in filtered:
        out.extend(_split_long_paragraph(p))
    return out


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


# Bible ingest constants and regexes
BIBLE_AUTHOR_SLUG = "svjashhennoe_pisanie"
BIBLE_AUTHOR_NAME = "Священное Писание"
BIBLE_SECTION = "Священное Писание"

_BIBLE_FILENAME_RE = re.compile(
    r"^(\d+)_([^_]+)_(\d+)_(\d+)(?:_(\d+))?_.*\.md$"
)
_BIBLE_VERSE_PREFIX_RE = re.compile(r"^\S+\.\s*\d+:\d+(?:-\d+)?\s+")


def _parse_bible_filename(filename: str) -> tuple[int, int] | None:
    """Filename '0001_1Кор_1_1_Павел_...md' -> (chapter=1, verse=1)."""
    m = _BIBLE_FILENAME_RE.match(filename)
    if not m:
        return None
    return int(m.group(3)), int(m.group(4))


def _strip_verse_prefix(bible_verse: str) -> str:
    """Strip leading citation: '1Кор.1:1 Павел, …' -> 'Павел, …'."""
    return _BIBLE_VERSE_PREFIX_RE.sub("", bible_verse.strip())


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


def _is_bible_path(path: Path, output_dir: Path) -> bool:
    """Bible md lives under output/Bible/<book>/."""
    try:
        rel = path.relative_to(output_dir)
        return rel.parts[0] == "Bible"
    except ValueError:
        return False


async def _ingest_bible(c, bible_files: list[Path]) -> dict[str, int]:
    """One Bible verse per md file; group by book dir, then chapter.

    File frontmatter has `book_title`, `bible_verse` ("1Кор.1:1 текст"),
    `verse_number`. Filename pattern `NNNN_<book>_<chapter>_<verse>[_<end>]_...md`
    is more reliable for (chapter, verse) than `bible_verse` (occasional
    misattribution in upstream epubs). The verse text comes from
    `bible_verse` with the leading "<book>.<chapter>:<verse> " stripped.
    """
    if not bible_files:
        return {}

    by_book: dict[str, list[Path]] = {}
    for p in bible_files:
        by_book.setdefault(p.parent.name, []).append(p)

    await _upsert_author(c, BIBLE_AUTHOR_SLUG, BIBLE_AUTHOR_NAME,
                         None, BIBLE_SECTION)

    counts: dict[str, int] = {}
    for book_dir, paths in sorted(by_book.items()):
        book_title = ""
        # by_chapter[chapter_num][verse_num] = verse_text (dedup on duplicates)
        by_chapter: dict[int, dict[int, str]] = {}
        for p in paths:
            try:
                content = p.read_text(encoding="utf-8")
            except Exception as e:
                print(f"  [skip] {p}: {e}")
                continue
            m_fm = _FRONTMATTER_RE.match(content)
            if not m_fm:
                continue
            fm = _parse_frontmatter(m_fm.group(1))
            book_title = book_title or fm.get("book_title", "").strip()

            cv = _parse_bible_filename(p.name)
            if cv is None:
                continue
            chapter, verse = cv

            verse_text = _strip_verse_prefix(fm.get("bible_verse", ""))
            if not verse_text or len(verse_text) < 5:
                continue

            by_chapter.setdefault(chapter, {})[verse] = verse_text

        if not book_title or not by_chapter:
            continue

        book_slug = slugify(book_dir)
        work_slug = f"bible_{book_slug}"
        await _upsert_work(c, work_slug, BIBLE_AUTHOR_SLUG, book_title,
                           None, BIBLE_SECTION, None)

        total_verses = 0
        for chapter_num in sorted(by_chapter.keys()):
            verses = sorted(by_chapter[chapter_num].items())
            await c.execute(
                "DELETE FROM paragraphs WHERE work_slug=%s AND chapter_num=%s",
                [work_slug, chapter_num],
            )
            await _upsert_chapter(c, work_slug, chapter_num, None,
                                  f"Bible/{book_dir}")
            rows = [
                (work_slug, chapter_num, verse_num, text, 0, len(text))
                for verse_num, text in verses
            ]
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
            total_verses += len(rows)

        counts[work_slug] = total_verses

    return counts


async def run() -> None:
    await init_pool()
    md_files = list(settings.output_dir.rglob("*.md"))
    print(f"Found {len(md_files)} md files in {settings.output_dir}")

    patristic_files = [p for p in md_files if not _is_bible_path(p, settings.output_dir)]
    bible_files = [p for p in md_files if _is_bible_path(p, settings.output_dir)]
    print(f"  patristic: {len(patristic_files)}, bible: {len(bible_files)}")

    work_para_counts: dict[str, int] = {}

    with Progress() as progress:
        task = progress.add_task("Parsing md", total=len(patristic_files))
        async with conn() as c:
            async with c.transaction():
                for path in patristic_files:
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

                bible_counts = await _ingest_bible(c, bible_files)
                work_para_counts.update(bible_counts)

                for ws, count in work_para_counts.items():
                    await c.execute(
                        "UPDATE works SET paragraph_count=%s WHERE slug=%s",
                        [count, ws],
                    )

    await close_pool()
    print(f"Indexed {sum(work_para_counts.values())} paragraphs across {len(work_para_counts)} works "
          f"({sum(bible_counts.values()) if bible_files else 0} from Bible).")
