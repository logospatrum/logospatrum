"""Tests for bench_retrieval pure logic (no DB, no embeddings)."""
import os
import sys
from pathlib import Path

# Set POSTGRES_DSN BEFORE importing bench_retrieval, which asserts it exists
os.environ.setdefault("POSTGRES_DSN", "postgresql://dummy:dummy@localhost/dummy")

# Make scripts/ importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bench_retrieval import (
    classify_pass,
    parse_top_authors,
    parse_top_work_chapters,
)
from backend.eval_runner import GoldEntry


def test_at_least_one_match_via_topk_authors():
    entry = GoldEntry(
        query="x",
        category="addressed",
        expected_authors=["ioann_lestvichnik_prepodobnyj"],
        passing="at_least_one_match",
    )
    top = [
        {"citation": "ioann_lestvichnik_prepodobnyj/lestvica/0001/p1"},
        {"citation": "vasilij_velikij_svjatitel/work_x/0001/p1"},
    ]
    assert classify_pass(entry, semantic_top=top, lexical_top=[]) is True


def test_at_least_one_match_fails_when_expected_not_in_topk():
    entry = GoldEntry(
        query="x",
        category="addressed",
        expected_authors=["ioann_lestvichnik_prepodobnyj"],
        passing="at_least_one_match",
    )
    top = [
        {"citation": "grigorij_palama_svjatitel/triady/0001/p1"},
    ]
    assert classify_pass(entry, semantic_top=top, lexical_top=top) is False


def test_any_match_checks_work_and_chapter():
    entry = GoldEntry(
        query="x",
        category="thematic",
        expected_citations=[{"work": "lestvica", "chapter": 4}],
        passing="any_match",
    )
    top_hit = [{"citation": "ioann/lestvica/0004/p2"}]
    top_miss_chapter = [{"citation": "ioann/lestvica/0001/p2"}]
    assert classify_pass(entry, semantic_top=top_hit, lexical_top=[]) is True
    assert classify_pass(entry, semantic_top=top_miss_chapter, lexical_top=[]) is False


def test_at_least_two_authors():
    entry = GoldEntry(
        query="x",
        category="cross",
        expected_authors=["a", "b", "c"],
        passing="at_least_two_authors",
    )
    top = [
        {"citation": "a/wa/0001/p1"},
        {"citation": "b/wb/0001/p1"},
        {"citation": "z/wz/0001/p1"},
    ]
    assert classify_pass(entry, semantic_top=top, lexical_top=[]) is True


def test_adversarial_safe_is_skipped():
    entry = GoldEntry(
        query="x",
        category="adversarial",
        passing="adversarial_safe",
    )
    result = classify_pass(entry, semantic_top=[], lexical_top=[])
    assert result is None  # explicit "not applicable in retrieval-only bench"


def test_empty_or_low_confidence_uses_score_threshold():
    entry = GoldEntry(
        query="x",
        category="negative",
        passing="empty_or_low_confidence",
    )
    low = [{"citation": "a/wa/0001/p1", "score": 0.30}]
    high = [{"citation": "a/wa/0001/p1", "score": 0.85}]
    assert classify_pass(entry, semantic_top=low, lexical_top=[], low_conf_threshold=0.45) is True
    assert classify_pass(entry, semantic_top=high, lexical_top=[], low_conf_threshold=0.45) is False
