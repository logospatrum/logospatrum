"""Orchestrator: scrape→download→markdown-convert for a list of new author URLs.

Drives the legacy `Scraper` / `Downloader` / `MarkdownConverter` classes (which
were never wired into the typer CLI) over the JSON diff produced by
`scripts/canonized_diff.py`. Skip-existing semantics:

  - Per author: if `data/<section>/<author>/` exists, `scrape_author_works`
    skips works whose `.json` is already on disk.
  - Per epub: `Downloader.download_epub` skips if the target `.epub` exists.
  - Per chapter: `MarkdownConverter` always rewrites md (not strictly
    idempotent at the file-write level but content-stable for a given epub).

Input JSON format (from canonized_diff.py):
    [{"url": "https://azbyka.ru/otechnik/<Slug>/",
      "name": "Аврелий Августин, блаженный",
      "expected_slug": "avrelij_avgustin_blazhennyj"},
     ...]
"""
from __future__ import annotations

import json
from pathlib import Path

from .config import settings
from .download import Downloader
from .markdown_convert import MarkdownConverter
from .models import AuthorMetadata
from .scrape import Scraper


# Default global section for azbyka's patristic library. All canonized authors
# live under this header on the site (and existing prod data uses the same).
DEFAULT_GLOBAL_SECTION = "Православная библиотека Святых отцов и церковных писателей"


def run(authors_file: str, global_section: str = DEFAULT_GLOBAL_SECTION) -> None:
    authors_path = Path(authors_file)
    if not authors_path.exists():
        raise FileNotFoundError(f"authors file not found: {authors_path}")

    entries: list[dict] = json.loads(authors_path.read_text(encoding="utf-8"))
    print(f"[ingest-azbyka] {len(entries)} authors from {authors_path}")

    data_dir = settings.data_dir
    data_dir.mkdir(parents=True, exist_ok=True)

    # --- Stage 1: scrape author pages → work-metadata JSONs ---
    with Scraper(settings) as scraper:
        for i, entry in enumerate(entries, 1):
            name = entry["name"]
            url = entry["url"]
            print(f"\n[{i:>3}/{len(entries)}] {name}")
            print(f"           {url}")

            author = AuthorMetadata(
                name=name,
                author_url=url,
                global_section=global_section,
                years_of_life=None,
            )

            safe_section = scraper._safe_filename(author.global_section)
            safe_author = scraper._safe_filename(author.name)
            author_dir = data_dir / safe_section / safe_author

            try:
                works = scraper.scrape_author_works(author, author_dir)
            except Exception as e:
                print(f"           [skip-author] {e!r}")
                continue
            print(f"           found {len(works)} new works")

            successful: list = []
            for w in works:
                print(f"           · {w.title[:80]}")
                enriched = scraper.scrape_work_page(w)
                if enriched:
                    successful.append(enriched)

            author.works = successful
            if successful:
                scraper.save_metadata(author, data_dir)

    print("\n[ingest-azbyka] stage 1 (metadata scrape) complete")

    # --- Stage 2: download epubs (skip-if-exists per file) ---
    print("\n[ingest-azbyka] stage 2: downloading epubs...")
    with Downloader(settings) as downloader:
        downloader.run()

    # --- Stage 3: convert epubs to markdown ---
    print("\n[ingest-azbyka] stage 3: converting epubs to markdown...")
    converter = MarkdownConverter(settings)
    converter.run()

    print("\n[ingest-azbyka] all done.")
