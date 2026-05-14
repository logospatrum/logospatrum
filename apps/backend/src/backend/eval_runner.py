"""Goldset eval: pure logic for matching expectations to agent transcripts."""
from dataclasses import dataclass
from typing import Literal

import yaml


PassingRule = Literal[
    "any_match",
    "at_least_one_match",
    "at_least_two_authors",
    "empty_or_low_confidence",
]


@dataclass
class GoldEntry:
    query: str
    category: str  # 'addressed', 'thematic', 'negative', 'cross'
    expected_citations: list[dict] | None = None
    expected_authors: list[str] | None = None
    passing: PassingRule = "any_match"


@dataclass
class EvalResult:
    entry: GoldEntry
    citations_used: list[str]
    final_text: str
    passed: bool
    reason: str


def load_goldset(path: str) -> list[GoldEntry]:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return [
        GoldEntry(
            query=item["query"],
            category=item.get("category", "thematic"),
            expected_citations=item.get("expected_citations"),
            expected_authors=item.get("expected_authors"),
            passing=item.get("passing", "any_match"),
        )
        for item in data
    ]


def _author_of(citation: str) -> str:
    return citation.split("/", 1)[0] if "/" in citation else citation


def _work_of(citation: str) -> str:
    parts = citation.split("/")
    return parts[1] if len(parts) >= 2 else ""


def _chapter_of(citation: str) -> int | None:
    parts = citation.split("/")
    if len(parts) >= 3:
        try:
            return int(parts[2])
        except ValueError:
            return None
    return None


def evaluate(entry: GoldEntry, citations_used: list[str], final_text: str) -> EvalResult:
    rule = entry.passing

    if rule == "empty_or_low_confidence":
        if len(citations_used) == 0:
            return EvalResult(entry, citations_used, final_text, True, "no citations as expected")
        markers = ["не найдено", "не в корпусе", "вне корпуса", "not in the corpus"]
        if any(m in final_text.lower() for m in markers):
            return EvalResult(entry, citations_used, final_text, True, "refusal detected")
        return EvalResult(entry, citations_used, final_text, False,
                          f"expected refusal, got {len(citations_used)} citations")

    if rule == "at_least_one_match":
        if entry.expected_authors:
            authors_used = {_author_of(c) for c in citations_used}
            ok = bool(authors_used & set(entry.expected_authors))
            return EvalResult(entry, citations_used, final_text, ok,
                              f"authors used={authors_used}, expected={entry.expected_authors}")
        return EvalResult(entry, citations_used, final_text, len(citations_used) >= 1,
                          f"len(citations)={len(citations_used)}")

    if rule == "any_match":
        if not entry.expected_citations:
            return EvalResult(entry, citations_used, final_text, len(citations_used) >= 1,
                              "no expected_citations specified, falling back to len≥1")
        for exp in entry.expected_citations:
            for c in citations_used:
                if _work_of(c) == exp["work"] and (
                    "chapter" not in exp or _chapter_of(c) == exp["chapter"]
                ):
                    return EvalResult(entry, citations_used, final_text, True,
                                      f"matched expected citation {exp}")
        return EvalResult(entry, citations_used, final_text, False,
                          f"none of {entry.expected_citations} matched citations {citations_used}")

    if rule == "at_least_two_authors":
        if not entry.expected_authors:
            return EvalResult(entry, citations_used, final_text, False,
                              "expected_authors required for this rule")
        authors_used = {_author_of(c) for c in citations_used}
        common = authors_used & set(entry.expected_authors)
        ok = len(common) >= 2
        return EvalResult(entry, citations_used, final_text, ok,
                          f"common authors={common}")

    return EvalResult(entry, citations_used, final_text, False, f"unknown rule {rule}")


def summary(results: list[EvalResult]) -> dict:
    by_cat: dict[str, dict] = {}
    for r in results:
        cat = r.entry.category
        d = by_cat.setdefault(cat, {"total": 0, "passed": 0, "failed": []})
        d["total"] += 1
        if r.passed:
            d["passed"] += 1
        else:
            d["failed"].append({"query": r.entry.query, "reason": r.reason})
    for cat, d in by_cat.items():
        d["pass_rate"] = d["passed"] / d["total"] if d["total"] else 0.0
    return by_cat
