"""Unit tests for embed window construction (pure function, no DB)."""
import pytest
from pipeline.embed import _build_windows_for_chapter


def test_empty_chapter() -> None:
    assert _build_windows_for_chapter([]) == []


def test_single_paragraph() -> None:
    # 1 paragraph -> only 1-size window
    out = _build_windows_for_chapter([(1, "alpha")])
    assert out == [(1, 1, "alpha")]


def test_two_paragraphs() -> None:
    # 2 paragraphs -> 1-size:2, 2-size:1, 3-size:0
    out = _build_windows_for_chapter([(1, "alpha"), (2, "beta")])
    assert (1, 1, "alpha") in out
    assert (2, 1, "beta") in out
    assert (1, 2, "alpha\n\nbeta") in out
    # no 3-size
    assert all(w != 3 for _, w, _ in out)
    assert len(out) == 3


def test_three_paragraphs_full_windows() -> None:
    paras = [(1, "a"), (2, "b"), (3, "c")]
    out = _build_windows_for_chapter(paras)
    # Expected: 3 + 2 + 1 = 6 windows
    assert len(out) == 6
    starts_by_size = {1: [], 2: [], 3: []}
    for start, size, _ in out:
        starts_by_size[size].append(start)
    assert sorted(starts_by_size[1]) == [1, 2, 3]
    assert sorted(starts_by_size[2]) == [1, 2]
    assert sorted(starts_by_size[3]) == [1]


def test_paragraphs_sorted_before_windowing() -> None:
    # Input out-of-order must still produce ordered windows
    paras = [(3, "c"), (1, "a"), (2, "b")]
    out = _build_windows_for_chapter(paras)
    # The 3-size window should be a\n\nb\n\nc starting at para 1
    big = [(s, w, t) for s, w, t in out if w == 3]
    assert big == [(1, 3, "a\n\nb\n\nc")]


def test_window_text_uses_double_newline_separator() -> None:
    out = _build_windows_for_chapter([(1, "x"), (2, "y")])
    two = [t for s, w, t in out if w == 2][0]
    assert two == "x\n\ny"


def test_window_start_uses_first_para_num() -> None:
    # Even if para nums are not 1-based or are sparse, start = first in window
    paras = [(10, "a"), (11, "b"), (12, "c"), (13, "d")]
    out = _build_windows_for_chapter(paras)
    # 3-size windows: start at 10 and 11
    threes = sorted([(s, t) for s, w, t in out if w == 3])
    assert threes == [(10, "a\n\nb\n\nc"), (11, "b\n\nc\n\nd")]


def test_window_count_formula() -> None:
    # For n paragraphs: count = n + max(0,n-1) + max(0,n-2)
    for n in range(1, 8):
        paras = [(i, f"p{i}") for i in range(1, n + 1)]
        out = _build_windows_for_chapter(paras)
        expected = n + max(0, n - 1) + max(0, n - 2)
        assert len(out) == expected, f"n={n}: got {len(out)}, expected {expected}"
