"""Shared filter helpers for lexical_search / semantic_search.

Both tools accept the same optional filters:
- author_slug: str | list[str]   → exact match or ANY(...)
- work_slug:   str | list[str]   → exact match or ANY(...)
- section:     str               → maps friendly aliases to the real
                                   authors.global_section value
"""
from __future__ import annotations

SECTION_ALIASES = {
    # Bible
    "bible": "Священное Писание",
    "scripture": "Священное Писание",
    "писание": "Священное Писание",
    "священное писание": "Священное Писание",
    # Patristic library
    "patristic": "Православная библиотека Святых отцов и церковных писателей",
    "fathers": "Православная библиотека Святых отцов и церковных писателей",
    "патристика": "Православная библиотека Святых отцов и церковных писателей",
}


def resolve_section(value: str) -> str:
    """Map a user-friendly section alias to the canonical authors.global_section.

    Unknown values pass through unchanged so an exact string still works.
    """
    return SECTION_ALIASES.get(value.lower(), value)


def slug_filter_sql(field: str, value: str | list[str] | None) -> tuple[str, list]:
    """Return (sql_fragment, params) for an `author_slug` / `work_slug` filter.

    Examples:
        slug_filter_sql("w.author_slug", "ioann_zlatoust_svjatitel")
            -> ("w.author_slug = %s", ["ioann_zlatoust_svjatitel"])
        slug_filter_sql("e.work_slug", ["a", "b"])
            -> ("e.work_slug = ANY(%s)", [["a", "b"]])
        slug_filter_sql("w.author_slug", None)
            -> ("", [])
        slug_filter_sql("w.author_slug", [])
            -> ("", [])  # empty list treated as "no filter"
    """
    if value is None or (isinstance(value, list) and not value):
        return "", []
    if isinstance(value, list):
        return f"{field} = ANY(%s)", [value]
    return f"{field} = %s", [value]
