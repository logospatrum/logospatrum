"""Tests for bench_diff pure logic."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bench_diff import jaccard, summarize_diff


def test_jaccard_empty_sets():
    assert jaccard(set(), set()) == 1.0  # both empty = identical


def test_jaccard_disjoint():
    assert jaccard({"a"}, {"b"}) == 0.0


def test_jaccard_partial_overlap():
    assert jaccard({"a", "b", "c", "d"}, {"a", "b", "x", "y"}) == 2 / 6


def test_summarize_includes_pass_rate_deltas():
    base = {
        "summary": {
            "by_category": {
                "addressed": {"total": 10, "pass": 8, "pass_rate": 0.8, "skip": 0},
                "thematic": {"total": 5, "pass": 3, "pass_rate": 0.6, "skip": 0},
            },
            "latency_ms": {"semantic_p50": 50.0, "semantic_p95": 200.0,
                           "semantic_p99": 400.0, "lexical_p50": 20.0,
                           "lexical_p95": 80.0, "lexical_p99": 150.0},
        },
        "per_query": [],
    }
    target = {
        "summary": {
            "by_category": {
                "addressed": {"total": 10, "pass": 7, "pass_rate": 0.7, "skip": 0},
                "thematic": {"total": 5, "pass": 4, "pass_rate": 0.8, "skip": 0},
            },
            "latency_ms": {"semantic_p50": 60.0, "semantic_p95": 250.0,
                           "semantic_p99": 500.0, "lexical_p50": 22.0,
                           "lexical_p95": 90.0, "lexical_p99": 160.0},
        },
        "per_query": [],
    }
    md = summarize_diff(base, target)
    assert "addressed" in md
    assert "-0.10" in md or "-10" in md  # delta surfaced somehow
    assert "thematic" in md
    assert "p95" in md
