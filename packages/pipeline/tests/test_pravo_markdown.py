from pathlib import Path
import pytest
from pipeline.pravo_authors import KANONICHESKOE_PRAVO, FATHER_GROUP_TO_AUTHOR
from pipeline.pravo_index import parse_grouped_index
from pipeline.pravo_markdown import (
    WorkMeta,
    _POMESTNY_TITLES,
    _VSELENSKY_TITLES,
    build_work_meta,
    render_rule,
)
from pipeline.pravo_rule import ParsedRule, Commentary
from pipeline.paragraphs import parse_md

FIX = Path(__file__).parent / "fixtures" / "pravo"


def _sample_rule() -> ParsedRule:
    return ParsedRule(
        rule_num=17,
        h1="Правило 17",
        short_content="О подобающем покаянии двоежёнца.",
        ru_text="Двоежёнец отлучается от Причастия на один год…",
        commentaries=[
            Commentary("Зонара", "Это правило говорит о…"),
            Commentary("Аристен", "Двоежёнец год кается."),
        ],
    )


def test_build_work_meta_apostolic():
    meta = build_work_meta(collection="apostolskie", group_title="Правила святых апостолов")
    assert meta.author == KANONICHESKOE_PRAVO
    assert meta.work_title == "Правила святых апостолов"


def test_build_work_meta_vselensky_iv_halkidonskij():
    meta = build_work_meta(
        collection="vselenskih-soborov",
        group_title="IV Вселенский Собор – Халкидонский (451г.)",
    )
    assert meta.author == KANONICHESKOE_PRAVO
    assert meta.work_title == "Правила IV Вселенского собора (Халкидонского)"


@pytest.mark.parametrize("group_title,expected_work_title", [
    ("Анкирский Собор (314г.)", "Правила Анкирского собора"),
    ("Неокесарийский Собор (315г.)", "Правила Неокесарийского собора"),
    ("Гангрский Собор (340г.)", "Правила Гангрского собора"),
    ("Антиохийский Собор (341г.)", "Правила Антиохийского собора"),
    ("Сардикийский Собор (347г.)", "Правила Сардикийского собора"),
    ("Лаодикийский Собор (360г.)", "Правила Лаодикийского собора"),
    ("Карфагенский Собор (393-419 гг.)", "Правила Карфагенского собора"),
    ("Константинопольский (394г.)", "Правила Константинопольского собора (394 г.)"),
    ("Константинопольский Двукратный Собор (861г.)", "Правила Константинопольского Двукратного собора"),
    ("Константинопольский Собор, во храме Св. Софии - Премудрости Божией (879г.)",
     "Правила Константинопольского собора в храме Святой Софии (879 г.)"),
])
def test_build_work_meta_pomestny_covers_all_ten_councils(group_title, expected_work_title):
    meta = build_work_meta(collection="pomestnyh-soborov", group_title=group_title)
    assert meta.author == KANONICHESKOE_PRAVO
    assert meta.work_title == expected_work_title


def test_build_work_meta_pomestny_unknown_raises():
    with pytest.raises(KeyError):
        build_work_meta(collection="pomestnyh-soborov",
                        group_title="Какой-то Несуществующий Собор (1234г.)")


def test_build_work_meta_father_uses_existing_author():
    meta = build_work_meta(
        collection="svyatootecheskie",
        group_title="Правила свт. Василия Великого (†379)",
    )
    assert meta.author.slug == "vasilij_velikij_svjatitel"
    assert meta.work_title == "Канонические правила"


def test_render_rule_returns_patristic_compatible_frontmatter():
    rule = _sample_rule()
    meta = WorkMeta(
        author=FATHER_GROUP_TO_AUTHOR["Правила свт. Василия Великого (†379)"],
        work_title="Канонические правила",
    )
    rel_path, content = render_rule(
        rule, meta,
        source_url="https://azbyka.ru/pravo/vasiliya-velikogo-17/",
    )
    assert rel_path == Path(
        "Каноническое_право/Василий_Великий_святитель/Канонические_правила/0017_pravilo_17.md"
    )
    assert content.startswith("---\n")
    assert "author: Василий Великий, святитель" in content
    assert "book_title: Канонические правила" in content
    assert "chapter_number: 17" in content
    assert "section: Каноническое право" in content
    assert "source_url: https://azbyka.ru/pravo/vasiliya-velikogo-17/" in content
    assert "author_years_of_life: †379" in content
    assert "global_section: Православная библиотека Святых отцов и церковных писателей" in content


def test_render_rule_body_has_blank_separated_paragraphs(tmp_path):
    rule = _sample_rule()
    meta = WorkMeta(
        author=FATHER_GROUP_TO_AUTHOR["Правила свт. Василия Великого (†379)"],
        work_title="Канонические правила",
    )
    rel_path, content = render_rule(
        rule, meta, source_url="https://azbyka.ru/pravo/x/",
    )

    # Write and round-trip through the existing paragraphs parser
    f = tmp_path / "rule.md"
    f.write_text(content, encoding="utf-8")
    parsed = parse_md(f)

    # 1 rule text + 2 commentaries = 3 paragraphs
    assert len(parsed.paragraphs) == 3
    assert parsed.paragraphs[0] == "Двоежёнец отлучается от Причастия на один год…"
    assert parsed.paragraphs[1].startswith("Зонара. ")
    assert parsed.paragraphs[2].startswith("Аристен. ")
    # Frontmatter round-trips
    assert parsed.frontmatter["author"] == "Василий Великий, святитель"
    assert parsed.frontmatter["chapter_number"] == "17"


def test_render_rule_for_pseudo_author_dir():
    rule = _sample_rule()
    meta = WorkMeta(author=KANONICHESKOE_PRAVO, work_title="Правила святых апостолов")
    rel_path, content = render_rule(
        rule, meta, source_url="https://azbyka.ru/pravo/17-apostolskoe-pravilo/",
    )
    assert rel_path == Path(
        "Каноническое_право/Каноническое_право/Правила_святых_апостолов/0017_pravilo_17.md"
    )
    assert "author: Каноническое право" in content
    assert "global_section: Каноническое право" in content
    # Pseudo-author has no years_of_life
    assert "author_years_of_life:" in content
    fm_block = content.split("---")[1]
    yol_line = next(l for l in fm_block.splitlines() if l.startswith("author_years_of_life"))
    assert yol_line.split(":", 1)[1].strip() == ""


def test_pomestny_dict_covers_every_group_in_index_fixture():
    """Every group_title parsed from the live /pravo/pomestnyh-soborov/ HTML
    must be a key in _POMESTNY_TITLES; otherwise the Task 6 collector will
    raise KeyError on a real council. This is the dict's contract: it must
    match azbyka byte-for-byte (hyphen vs en-dash, narrow space, etc.).
    """
    html = (FIX / "index_pomestnyh.html").read_text(encoding="utf-8")
    entries = parse_grouped_index(html, collection="pomestnyh-soborov")
    fixture_groups = {e.group_title for e in entries}
    missing = fixture_groups - set(_POMESTNY_TITLES)
    assert not missing, f"_POMESTNY_TITLES is missing keys: {missing}"
    # And the reverse — no orphan dict entries
    orphans = set(_POMESTNY_TITLES) - fixture_groups
    assert not orphans, f"_POMESTNY_TITLES has unused keys: {orphans}"


def test_vselensky_dict_covers_every_group_in_index_fixture():
    """Same contract as the pomestny check, for the Vselensky index."""
    html = (FIX / "index_vselenskih.html").read_text(encoding="utf-8")
    entries = parse_grouped_index(html, collection="vselenskih-soborov")
    fixture_groups = {e.group_title for e in entries}
    missing = fixture_groups - set(_VSELENSKY_TITLES)
    assert not missing, f"_VSELENSKY_TITLES is missing keys: {missing}"
    orphans = set(_VSELENSKY_TITLES) - fixture_groups
    assert not orphans, f"_VSELENSKY_TITLES has unused keys: {orphans}"
