"""Unit tests for tools._filters (pure helpers, no DB)."""
import pytest

from backend.tools._filters import resolve_section, slug_filter_sql


@pytest.mark.parametrize("inp, expected", [
    ("bible", "Священное Писание"),
    ("Bible", "Священное Писание"),
    ("BIBLE", "Священное Писание"),
    ("scripture", "Священное Писание"),
    ("писание", "Священное Писание"),
    ("Священное Писание", "Священное Писание"),
    ("patristic", "Православная библиотека Святых отцов и церковных писателей"),
    ("fathers", "Православная библиотека Святых отцов и церковных писателей"),
    ("патристика", "Православная библиотека Святых отцов и церковных писателей"),
])
def test_resolve_section_aliases(inp: str, expected: str) -> None:
    assert resolve_section(inp) == expected


def test_resolve_section_unknown_passes_through() -> None:
    # Exact strings that aren't aliases must round-trip unchanged so callers
    # can still pass a raw `global_section` value.
    assert resolve_section("Some Custom Section") == "Some Custom Section"


def test_slug_filter_sql_single_value() -> None:
    sql, params = slug_filter_sql("w.author_slug", "ioann_zlatoust_svjatitel")
    assert sql == "w.author_slug = %s"
    assert params == ["ioann_zlatoust_svjatitel"]


def test_slug_filter_sql_list_value() -> None:
    sql, params = slug_filter_sql("w.author_slug", ["a", "b", "c"])
    assert sql == "w.author_slug = ANY(%s)"
    assert params == [["a", "b", "c"]]


def test_slug_filter_sql_none() -> None:
    sql, params = slug_filter_sql("w.author_slug", None)
    assert sql == ""
    assert params == []


def test_slug_filter_sql_empty_list_disables_filter() -> None:
    # Important: an empty list MUST mean "no filter applied", not "match nothing".
    # An LLM dropping `author_slug=[]` should behave like "filter omitted".
    sql, params = slug_filter_sql("w.author_slug", [])
    assert sql == ""
    assert params == []
