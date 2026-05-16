"""Render a ParsedRule into a patristic-flow markdown file.

Output path layout:
  output/Каноническое_право/<author_dir>/<work_dir>/NNNN_pravilo_N.md

Frontmatter mirrors what MarkdownConverter emits for /otechnik/ md files
(see pipeline/markdown_convert.py), so `paragraphs.run()` consumes us
without changes.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from pathlib import Path

from .pravo_authors import AuthorRef, KANONICHESKOE_PRAVO, resolve_father
from .pravo_rule import ParsedRule

CANON_SECTION = "Каноническое право"
CANON_ROOT_DIR = "Каноническое_право"

# Group title → display work title, for council collections.
_VSELENSKY_TITLES = {
    "I Вселенский Собор – Никейский (325г.)":            "Правила I Вселенского собора (Никейского)",
    "II Вселенский Собор – Константинопольский (381г.)": "Правила II Вселенского собора (Константинопольского)",
    "III Вселенский Собор – Эфесский (431г.)":           "Правила III Вселенского собора (Эфесского)",
    "IV Вселенский Собор – Халкидонский (451г.)":        "Правила IV Вселенского собора (Халкидонского)",
    "V-VI Вселенский Собор – Константинопольский, Трулльский (691г.)":
        "Правила V-VI Вселенского собора (Трулльского)",
    "VII Вселенский Собор – Никейский (787г.)":          "Правила VII Вселенского собора (Никейского)",
}

# Group title → display work title, for local council collection.
# All 10 historical councils; new entries require human review (build_work_meta
# raises KeyError on miss).
_POMESTNY_TITLES = {
    "Анкирский Собор (314г.)":                  "Правила Анкирского собора",
    "Неокесарийский Собор (315г.)":             "Правила Неокесарийского собора",
    "Гангрский Собор (340г.)":                  "Правила Гангрского собора",
    "Антиохийский Собор (341г.)":               "Правила Антиохийского собора",
    "Сардикийский Собор (347г.)":               "Правила Сардикийского собора",
    "Лаодикийский Собор (360г.)":               "Правила Лаодикийского собора",
    "Карфагенский Собор (393-419 гг.)":         "Правила Карфагенского собора",
    "Константинопольский (394г.)":              "Правила Константинопольского собора (394 г.)",
    "Константинопольский Двукратный Собор (861г.)": "Правила Константинопольского Двукратного собора",
    "Константинопольский Собор, во храме Св. Софии - Премудрости Божией (879г.)": "Правила Константинопольского собора в храме Святой Софии (879 г.)",
}


def _safe_filename(name: str) -> str:
    """Match scrape.py:210 — keep only [\\w]+ runs, joined by _ (no maxlen here)."""
    words = re.findall(r"[\w]+", name, flags=re.UNICODE)
    return "_".join(words)


@dataclass(frozen=True)
class WorkMeta:
    author: AuthorRef
    work_title: str


def build_work_meta(collection: str, group_title: str) -> WorkMeta:
    if collection == "apostolskie":
        return WorkMeta(author=KANONICHESKOE_PRAVO, work_title="Правила святых апостолов")
    if collection == "vselenskih-soborov":
        title = _VSELENSKY_TITLES.get(group_title)
        if title is None:
            raise KeyError(f"unknown vselensky group: {group_title!r}")
        return WorkMeta(author=KANONICHESKOE_PRAVO, work_title=title)
    if collection == "pomestnyh-soborov":
        title = _POMESTNY_TITLES.get(group_title)
        if title is None:
            raise KeyError(f"unknown pomestny group: {group_title!r}")
        return WorkMeta(author=KANONICHESKOE_PRAVO, work_title=title)
    if collection == "svyatootecheskie":
        return WorkMeta(author=resolve_father(group_title), work_title="Канонические правила")
    raise ValueError(f"unknown collection: {collection!r}")


def _frontmatter(meta: WorkMeta, rule: ParsedRule, source_url: str) -> str:
    chapter_title = f"Правило {rule.rule_num}"
    if rule.short_content:
        chapter_title = f"{chapter_title}. {rule.short_content}"
    yol = meta.author.years_of_life or ""
    # Mirror the patristic flow: global_section is the patristic library for
    # father canons; for pseudo-author it's "Каноническое право".
    return (
        "---\n"
        f"author: {meta.author.name_display}\n"
        f"book_title: {meta.work_title}\n"
        f"chapter_title: {chapter_title}\n"
        f"chapter_number: {rule.rule_num}\n"
        f"section: {CANON_SECTION}\n"
        f"source_url: {source_url}\n"
        f"global_section: {meta.author.global_section}\n"
        f"author_years_of_life: {yol}\n"
        f"creation_date: \n"
        "---\n"
    )


def render_rule(rule: ParsedRule, meta: WorkMeta, source_url: str) -> tuple[Path, str]:
    """Return (relative_output_path, full_markdown_content)."""
    body_blocks: list[str] = []
    if rule.ru_text:
        body_blocks.append(rule.ru_text)
    for c in rule.commentaries:
        body_blocks.append(f"{c.author}. {c.text}")
    body = "\n\n".join(body_blocks) + "\n"

    content = _frontmatter(meta, rule, source_url) + "\n" + body

    author_dir = _safe_filename(meta.author.name_display)
    work_dir = _safe_filename(meta.work_title)
    fname = f"{rule.rule_num:04d}_pravilo_{rule.rule_num}.md"
    rel_path = Path(CANON_ROOT_DIR) / author_dir / work_dir / fname
    return rel_path, content
