"""Pure parser for an /pravo/<rule-slug>/ article page.

Extracts: rule number, h1, short_content, full Russian text, and the list
of inline commentaries (Зонара, Аристен, Вальсамон, Синопсис,
Славянская кормчая, Матфей Властарь). Greek (lang-el) is dropped.
"See by link" stubs (Никодим Милаш, Пидалион) are dropped.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

_H1_RULE_NUM_RE = re.compile(r"Правило\s+(\d+)")
# A <p> is a "see by link" stub when it has the shape:
#   <p><a href="…"><strong>Толкование еп. Никодима (Милаша)</strong></a>. См. по ссылке.</p>
# Detection: contains "См. по ссылке" literal (case-insensitive).
_SEE_BY_LINK_RE = re.compile(r"См\.\s*по\s*ссылке", re.IGNORECASE)


@dataclass(frozen=True)
class Commentary:
    author: str
    text: str


@dataclass(frozen=True)
class ParsedRule:
    rule_num: int
    h1: str
    short_content: str
    ru_text: str
    commentaries: list[Commentary] = field(default_factory=list)


def _join_paragraphs(parent: Tag) -> str:
    """Concat direct-child <p> blocks separated by blank line."""
    parts = [p.get_text(" ", strip=True) for p in parent.find_all("p", recursive=False)]
    return "\n\n".join(p for p in parts if p)


def _interp_title_text(p: Tag) -> str | None:
    """If <p> starts with <b class="interp-title">, return commentator name; else None."""
    b = p.find("b", class_="interp-title", recursive=False)
    if b is None:
        # Sometimes the <b> is wrapped slightly differently (e.g. first child is
        # whitespace, then <b>). Fall back to children scan.
        for child in p.children:
            if getattr(child, "name", None) == "b" and "interp-title" in (child.get("class") or []):
                b = child
                break
    if b is None:
        return None
    return b.get_text(strip=True)


def _paragraph_text_without(p: Tag, b: Tag | None) -> str:
    """Return the <p> text content with the leading <b class=interp-title> stripped."""
    parts: list[str] = []
    for child in p.children:
        if child is b:
            continue
        if hasattr(child, "get_text"):
            parts.append(child.get_text(" ", strip=True))
        else:
            parts.append(str(child).strip())
    text = " ".join(parts).strip()
    # Leading "." or "." + space remnant from "<b>Author</b>. text" → strip
    text = re.sub(r"^[.\s]+", "", text)
    return text


def parse_rule_html(html: str) -> ParsedRule:
    soup = BeautifulSoup(html, "lxml")
    article = soup.find("article", class_="article-single")
    if article is None:
        raise ValueError("article.article-single not found")

    # h1
    h1_tag = article.find("h1")
    h1 = h1_tag.get_text(strip=True) if h1_tag else ""
    m = _H1_RULE_NUM_RE.search(h1)
    rule_num = int(m.group(1)) if m else 0

    content = article.find("div", class_="article-single-content")
    if content is None:
        raise ValueError("article-single-content not found")

    # short_content
    sc_div = content.find("div", class_="short-content", recursive=False)
    short_content = _join_paragraphs(sc_div) if sc_div else ""

    # russian text only
    translations = content.find("div", class_="translations", recursive=False)
    ru_text = ""
    if translations is not None:
        ru_div = translations.find("div", class_="lang-ru", recursive=False)
        if ru_div is not None:
            ru_text = _join_paragraphs(ru_div)

    # commentaries — every direct-child <p> in content that begins with
    # <b class="interp-title">, plus the optional mens-legislatoris div.
    commentaries: list[Commentary] = []
    for p in content.find_all("p", recursive=False):
        # Skip "See by link" stubs even though they don't have interp-title — be belt-and-suspenders
        if _SEE_BY_LINK_RE.search(p.get_text(" ", strip=True) or ""):
            continue
        b = p.find("b", class_="interp-title", recursive=False)
        if b is None:
            continue
        author = b.get_text(strip=True)
        text = _paragraph_text_without(p, b)
        if author and text:
            commentaries.append(Commentary(author=author, text=text))

    mens = content.find("div", class_="mens-legislatoris", recursive=False)
    if mens is not None:
        mens_text = _join_paragraphs(mens)
        # mens-legislatoris always cites Матфей Властарь — text starts with
        # "Комментарий канониста иеромонаха Матфея Властаря:". We use author
        # "Матфей Властарь" uniformly.
        if mens_text:
            commentaries.append(Commentary(author="Матфей Властарь", text=mens_text))

    return ParsedRule(
        rule_num=rule_num,
        h1=h1,
        short_content=short_content,
        ru_text=ru_text,
        commentaries=commentaries,
    )
