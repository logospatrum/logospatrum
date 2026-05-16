"""Pure parsers for /pravo/ index pages.

Two variants:
- Apostolic index has only a flat <ul class="post-list"> under main-area-content.
- All other indexes wrap groups in <ul class="cat-list"> > <li>{group <a>, <ul.post-list>}.
"""
from __future__ import annotations
from dataclasses import dataclass
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

BASE_URL = "https://azbyka.ru"


@dataclass(frozen=True)
class IndexEntry:
    collection: str  # set by caller, not from HTML
    group_title: str
    group_url: str | None
    rule_num: int
    rule_url: str
    short_content: str


def _main_content(soup: BeautifulSoup) -> Tag:
    """The main-area-content section holds the rule list; everything else
    (top widgets, footer "popular rules") would otherwise pollute results."""
    section = soup.find("section", class_="main-area-content")
    if section is None:
        raise ValueError("main-area-content section not found")
    return section


def _extract_rules(post_list: Tag, group_title: str, group_url: str | None,
                   collection: str) -> list[IndexEntry]:
    out: list[IndexEntry] = []
    for li in post_list.find_all("li", recursive=False):
        a = li.find("a", class_="az-tip")
        if not a:
            continue
        href = a.get("href", "")
        if not href:
            continue
        # Text content of <a> is the rule number digit(s)
        try:
            rule_num = int(a.get_text(strip=True))
        except ValueError:
            continue
        short = (a.get("title") or "").strip()
        out.append(IndexEntry(
            collection=collection,
            group_title=group_title,
            group_url=group_url,
            rule_num=rule_num,
            rule_url=urljoin(BASE_URL, href),
            short_content=short,
        ))
    return out


def parse_apostolic_index(html: str, collection: str = "apostolskie") -> list[IndexEntry]:
    soup = BeautifulSoup(html, "lxml")
    main = _main_content(soup)
    post_list = main.find("ul", class_="post-list")
    if not post_list:
        return []
    entries = _extract_rules(post_list, "Правила святых апостолов", None, collection)
    return sorted(entries, key=lambda e: e.rule_num)


def parse_grouped_index(html: str, collection: str = "") -> list[IndexEntry]:
    soup = BeautifulSoup(html, "lxml")
    main = _main_content(soup)
    cat_list = main.find("ul", class_="cat-list")
    if not cat_list:
        return []

    out: list[IndexEntry] = []
    for li in cat_list.find_all("li", recursive=False):
        a = li.find("a", recursive=False)
        if not a:
            continue
        group_title = a.get_text(strip=True)
        group_url = urljoin(BASE_URL, a.get("href", "")) or None
        post_list = li.find("ul", class_="post-list", recursive=False)
        if not post_list:
            continue
        out.extend(_extract_rules(post_list, group_title, group_url, collection))

    out.sort(key=lambda e: (e.group_title, e.rule_num))
    return out
