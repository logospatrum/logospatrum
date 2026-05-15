"""Unit tests for Bible-specific paragraphs.py helpers."""
import pytest

from pipeline.paragraphs import _parse_bible_filename, _strip_verse_prefix


@pytest.mark.parametrize("filename, expected", [
    ("0001_1Кор_1_1_Павел_волею_Божиею.md", (1, 1)),
    ("0002_1Кор_1_2_3_церкви_Божией.md", (1, 2)),  # verse range: start verse wins
    ("0001_Быт_1_1_В_начале_сотворил_Бог.md", (1, 1)),
    ("0001_Откр_1_1_Откровение_Иисуса.md", (1, 1)),
    ("1234_Откр_22_21_Благодать_Господа.md", (22, 21)),
])
def test_parse_bible_filename_known(filename: str, expected: tuple[int, int]) -> None:
    assert _parse_bible_filename(filename) == expected


@pytest.mark.parametrize("filename", [
    "garbage.md",
    "no_underscores.md",
    "0001_1Кор_no_chapter_verse.md",
    "0001_1Кор_1.md",  # missing verse
])
def test_parse_bible_filename_invalid(filename: str) -> None:
    assert _parse_bible_filename(filename) is None


@pytest.mark.parametrize("verse, expected", [
    ("1Кор.1:1 Павел, волею Божиею", "Павел, волею Божиею"),
    ("Откр.1:1 Откровение Иисуса", "Откровение Иисуса"),
    ("Чис. 1:1 1-я книга", "1-я книга"),                # space between '.' and chapter
    ("1Кор.1:2-3 церкви Божией", "церкви Божией"),       # verse range
    ("2Пет.3:8 У Господа один день", "У Господа один день"),
])
def test_strip_verse_prefix(verse: str, expected: str) -> None:
    assert _strip_verse_prefix(verse) == expected


def test_strip_verse_prefix_no_match_passthrough() -> None:
    # If no citation prefix, pass through as-is
    assert _strip_verse_prefix("just some text") == "just some text"


def test_strip_verse_prefix_empty() -> None:
    assert _strip_verse_prefix("") == ""
