"""Convert Bible-style epub files (Толковая Библия) → one-verse-per-md.

Bible epub structure differs from patristic works:
- chapters are wrapped in <h2 id="N_M"> sections (chapter.verse markers)
- each verse is a <div class="paragraph"> containing
  <span class="bibtext"><a>Быт.6:8</a></span><span>verse text</span>
- subsequent <div class="paragraph"> without bibtext are commentary

This converter writes one md per verse, with frontmatter:
    book_title: <full book name>
    bible_verse: "<ref> <verse text>"
    verse_number: <i>
And the body = anonymous commentary. It mirrors the format already present
in output/Bible/* so `pipeline.paragraphs._ingest_bible` can consume it.

Ported from sibling project `orthodox_rag/src/bible_converter.py`.

The `run()` skips books whose output dir already exists, so an incremental
re-run only processes new/missing books.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Generator, List, Tuple

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

from .config import settings


def _iter_metadata_files() -> Generator[Tuple[Path, dict], None, None]:
    bible_dir = settings.data_dir / "Bible"
    if not bible_dir.exists():
        return
    for json_path in bible_dir.glob("*.json"):
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        yield json_path, data


def _has_notes_marker(soup: BeautifulSoup) -> bool:
    for hr in soup.find_all("hr"):
        nxt = hr.find_next_sibling()
        if nxt and nxt.name == "h4":
            text = nxt.get_text()
            if "Примечания" in text or "notes" in text:
                return True
    return False


def _remove_notes_section(soup: BeautifulSoup) -> None:
    for hr in soup.find_all("hr", class_="calibre6"):
        nxt = hr.find_next_sibling()
        if nxt and nxt.name == "h4" and "Примечания" in nxt.get_text():
            for sibling in hr.find_next_siblings():
                sibling.decompose()
            hr.decompose()
            break


def _combine_verse_refs(refs: List[str]) -> str:
    if len(refs) == 1:
        return refs[0]
    first_ref = refs[0]
    last_ref = refs[-1]
    m = re.search(r":(\d+)", last_ref)
    if m:
        return f"{first_ref}-{m.group(1)}"
    return ", ".join(refs)


def _format_verse_with_text(refs: List[str], texts: List[str]) -> str:
    combined_ref = _combine_verse_refs(refs)
    combined_text = " ".join(texts)
    return f"{combined_ref} {combined_text}" if combined_text else combined_ref


_BIBLIA_HREF_RE = re.compile(r"azbyka\.ru/biblia")
_VERSE_REF_RE = re.compile(r"^\S+\.\s*\d+:\d+")


def _find_verse_ref_span(element) -> "BeautifulSoup | None":
    """Verse-ref span: either has class=bibtext, or contains an <a> linking
    to azbyka.ru/biblia (newer epubs dropped the bibtext class)."""
    bib = element.find("span", class_="bibtext")
    if bib is not None:
        return bib
    for span in element.find_all("span", recursive=False):
        a = span.find("a")
        if a and _BIBLIA_HREF_RE.search(a.get("href", "")):
            return span
        if _VERSE_REF_RE.match(span.get_text(strip=True)):
            return span
    return None


def _extract_verses(soup: BeautifulSoup) -> List[Tuple[str, str]]:
    """Return [(verse_ref_with_text, commentary), ...] from one epub document."""
    verses: List[Tuple[str, str]] = []
    cur_refs: List[str] = []
    cur_texts: List[str] = []
    cur_commentary: List[str] = []

    for element in soup.find_all(["div", "h2", "h3"]):
        if element.name in ("h2", "h3"):
            if cur_refs:
                verses.append((
                    _format_verse_with_text(cur_refs, cur_texts),
                    " ".join(cur_commentary),
                ))
                cur_refs, cur_texts, cur_commentary = [], [], []
            continue

        if element.name != "div":
            continue
        classes = element.get("class") or []
        if "paragraph" not in classes:
            continue

        bibtext = _find_verse_ref_span(element)
        if bibtext is not None:
            link = bibtext.find("a")
            verse_ref = (link.get_text(strip=True) if link else bibtext.get_text(strip=True))

            text_parts: List[str] = []
            for child in element.children:
                if child is bibtext:
                    continue
                if hasattr(child, "get_text"):
                    text_parts.append(child.get_text(strip=False))
                elif isinstance(child, str):
                    text_parts.append(str(child))
            text = " ".join(text_parts).strip()

            if cur_refs and cur_commentary:
                verses.append((
                    _format_verse_with_text(cur_refs, cur_texts),
                    " ".join(cur_commentary),
                ))
                cur_refs, cur_texts, cur_commentary = [], [], []

            cur_refs.append(verse_ref)
            if text:
                cur_texts.append(text)
        else:
            text = element.get_text(strip=False).strip()
            if text and cur_refs:
                cur_commentary.append(text)

    if cur_refs:
        verses.append((
            _format_verse_with_text(cur_refs, cur_texts),
            " ".join(cur_commentary),
        ))
    return verses


def _read_epub_verses(epub_path: Path) -> List[Tuple[str, str]]:
    if not epub_path.exists():
        return []
    book = epub.read_epub(str(epub_path))
    out: List[Tuple[str, str]] = []
    for item in book.get_items():
        if item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        content = item.get_content().decode("utf-8", errors="ignore")
        soup = BeautifulSoup(content, "html.parser")
        had_notes = _has_notes_marker(soup)
        if had_notes:
            _remove_notes_section(soup)
        out.extend(_extract_verses(soup))
        if had_notes:
            break
    return out


def _safe_filename(name: str) -> str:
    words = re.findall(r"[\w]+", name, re.UNICODE)
    return "_".join(words)[:50]


def _create_md(verse_ref_with_text: str, commentary: str,
               verse_number: int, book_title: str, book_url: str) -> str:
    frontmatter = (
        "---\n"
        f"book_title: {book_title}\n"
        f"bible_verse: {verse_ref_with_text}\n"
        f"verse_number: {verse_number}\n"
        f"source_url: {book_url}\n"
        "---\n\n"
    )
    return frontmatter + commentary


def run() -> None:
    """Convert Bible epubs to verse-per-md, skipping books already present."""
    output_root = settings.output_dir / "Bible"
    output_root.mkdir(parents=True, exist_ok=True)

    converted = 0
    skipped = 0
    for json_path, metadata in _iter_metadata_files():
        epub_path_str = metadata.get("epub_path")
        if not epub_path_str:
            continue
        epub_path = settings.data_dir.parent / epub_path_str
        if not epub_path.exists():
            print(f"  [skip] epub missing: {epub_path}")
            continue

        book_title = metadata.get("title", "Unknown")
        safe_book = _safe_filename(book_title)
        book_output_dir = output_root / safe_book

        if book_output_dir.exists() and any(book_output_dir.glob("*.md")):
            skipped += 1
            continue

        print(f"Converting: {book_title}", flush=True)
        verses = _read_epub_verses(epub_path)
        if not verses:
            print(f"  [warn] no verses parsed from {book_title}")
            continue

        for i, (verse_ref, commentary) in enumerate(verses, 1):
            md = _create_md(
                verse_ref_with_text=verse_ref,
                commentary=commentary,
                verse_number=i,
                book_title=book_title,
                book_url=metadata.get("work_url", ""),
            )
            safe_verse = _safe_filename(verse_ref)
            out_path = book_output_dir / f"{i:04d}_{safe_verse}.md"
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(md)
        converted += 1
        print(f"  -> {len(verses)} verses written to {book_output_dir.name}", flush=True)

    print(f"\nDone. Converted: {converted}, skipped (already present): {skipped}")
