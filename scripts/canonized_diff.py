"""Fetch canonized author list from azbyka.ru and compute diff against prod authors.

DOM contract (verified against live page 2026-05-27):
  - All authors render on a single page (no pagination)
  - Selector: a.authors-list__link
  - href looks like /otechnik/Avrelij_Avgustin/ (transliterated first+second name)
  - text content is the display name, e.g. "Аврелий Августин, блаженный"

The URL slug ≠ the DB slug. Pipeline derives DB slug via slugify(display_name);
diff comparison uses that derived slug, NOT the URL slug.

Usage:
    set POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@host:port/patristic
    PYTHONUTF8=1 .venv/Scripts/python scripts/canonized_diff.py \
        --output canonized_diff.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import unicodedata
import re
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

REPO_ROOT = Path(__file__).resolve().parents[1]

# Pipeline's slugify, inlined to avoid the pipeline venv import.
_RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "j", "к": "k",
    "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "ш": "sh", "щ": "shh", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "ju", "я": "ja",
}


def _translit(text: str) -> str:
    out = []
    for ch in text.lower():
        if ch in _RU:
            out.append(_RU[ch])
        elif "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out)


def slugify(text: str, max_length: int = 100) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = _translit(text)
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")
    if len(text) > max_length:
        text = text[:max_length].rstrip("_")
    return text


CANONIZED_URL = (
    "https://azbyka.ru/otechnik/"
    "?authorsFilterBy=canonized&authorsSortBy=authors_by_last_name"
)
BASE_URL = "https://azbyka.ru"


def parse_authors(html: str, base_url: str = BASE_URL) -> list[dict]:
    """Extract (url, display_name) pairs from an authors index page.

    Returns list of {"url": absolute_url, "name": display_name}, deduplicated
    by url.
    """
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for a in soup.select("a.authors-list__link"):
        href = a.get("href", "").strip()
        name = a.get_text(strip=True)
        if not href or not name:
            continue
        if "/otechnik/" not in href:
            continue
        out.append({"url": urljoin(base_url, href), "name": name})

    # Dedup by url
    seen: set[str] = set()
    deduped: list[dict] = []
    for a in out:
        if a["url"] in seen:
            continue
        seen.add(a["url"])
        deduped.append(a)
    return deduped


def fetch_canonized(url: str = CANONIZED_URL) -> list[dict]:
    with httpx.Client(
        timeout=30,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 logospatrum-pipeline/1.0"},
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return parse_authors(r.text)


async def fetch_prod_author_slugs(dsn: str) -> set[str]:
    import psycopg

    async with await psycopg.AsyncConnection.connect(
        dsn, connect_timeout=15
    ) as c:
        cur = await c.execute("SELECT slug FROM authors")
        rows = await cur.fetchall()
    return {r[0] for r in rows}


async def main_async(args: argparse.Namespace) -> int:
    dsn = os.environ.get("POSTGRES_DSN")
    if not dsn:
        print("ERROR: set POSTGRES_DSN", file=sys.stderr)
        return 1

    print(f"[canonized] fetching {args.url}")
    canonized = fetch_canonized(args.url)
    print(f"[canonized] {len(canonized)} authors found on page")

    print("[prod] querying author slugs...")
    prod_slugs = await fetch_prod_author_slugs(dsn)
    print(f"[prod] {len(prod_slugs)} authors in DB")

    diff: list[dict] = []
    for a in canonized:
        expected_slug = slugify(a["name"])
        if expected_slug not in prod_slugs:
            diff.append(
                {
                    "url": a["url"],
                    "name": a["name"],
                    "expected_slug": expected_slug,
                }
            )

    Path(args.output).write_text(
        json.dumps(diff, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"[diff] {len(diff)} authors NOT in prod, wrote {args.output}"
    )
    if diff:
        print("[sample] first 5 new authors:")
        for a in diff[:5]:
            print(f"  - {a['name']!r:50s} → slug={a['expected_slug']}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    p.add_argument("--url", default=CANONIZED_URL)
    args = p.parse_args()

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(
            asyncio.WindowsSelectorEventLoopPolicy()
        )
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
