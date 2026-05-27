"""Tests for canonized_diff pure logic (no live HTTP, no DB)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from canonized_diff import parse_authors, slugify


CANONIZED_HTML_FIXTURE = """
<html><body>
<h2 class="Bukva">А</h2>
<ul class="authors-list">
  <li class="authors-list__item">
    <a href="/otechnik/Avrelij_Avgustin/" class="authors-list__link ">
      Аврелий Августин, блаженный
    </a>
    <span class="author-date">354 — 430</span>
  </li>
  <li class="authors-list__item">
    <a href="/otechnik/Afanasij_Velikij/" class="authors-list__link ">
      Афанасий Великий, святитель
    </a>
  </li>
  <li class="authors-list__item">
    <a href="/otechnik/Sahar_A/" class="authors-list__link ">
      Сахаров Афанасий, святитель
    </a>
  </li>
</ul>
<h2 class="Bukva">В</h2>
<ul class="authors-list">
  <li class="authors-list__item">
    <a href="/otechnik/Vasilij_Velikij/" class="authors-list__link ">
      Василий Великий, святитель
    </a>
  </li>
</ul>
</body></html>
"""


def test_parse_authors_returns_url_and_name():
    authors = parse_authors(CANONIZED_HTML_FIXTURE)
    assert len(authors) == 4
    assert authors[0] == {
        "url": "https://azbyka.ru/otechnik/Avrelij_Avgustin/",
        "name": "Аврелий Августин, блаженный",
    }


def test_parse_authors_dedupes_by_url():
    html = (
        '<a href="/otechnik/A/" class="authors-list__link">Имя</a>'
        '<a href="/otechnik/A/" class="authors-list__link">Имя</a>'
    )
    assert len(parse_authors(html)) == 1


def test_parse_authors_skips_non_otechnik_links():
    html = (
        '<a href="/biblia/Ioann/" class="authors-list__link">не отец</a>'
        '<a href="/otechnik/Real/" class="authors-list__link">Реальный</a>'
    )
    out = parse_authors(html)
    assert len(out) == 1
    assert out[0]["name"] == "Реальный"


def test_parse_authors_handles_empty_input():
    assert parse_authors("") == []
    assert parse_authors("<html><body>no links</body></html>") == []


def test_slugify_matches_pipeline_convention():
    # Spot checks against actual pipeline output for representative names.
    assert slugify("Аврелий Августин, блаженный") == "avrelij_avgustin_blazhennyj"
    assert slugify("Иоанн Лествичник, преподобный") == "ioann_lestvichnik_prepodobnyj"
    assert slugify("Григорий Палама, святитель") == "grigorij_palama_svjatitel"


def test_slugify_empty_string():
    assert slugify("") == ""


def test_slugify_idempotent():
    s = slugify("Аврелий Августин, блаженный")
    assert slugify(s) == s
