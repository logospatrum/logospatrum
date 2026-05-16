from pathlib import Path
from pipeline.pravo_index import (
    IndexEntry,
    parse_apostolic_index,
    parse_grouped_index,
)

FIX = Path(__file__).parent / "fixtures" / "pravo"


def test_apostolic_index_returns_85_rules():
    html = (FIX / "index_apostolskie.html").read_text(encoding="utf-8")
    entries = parse_apostolic_index(html)
    assert len(entries) == 85
    # Sorted by rule number 1..85
    assert [e.rule_num for e in entries] == list(range(1, 86))
    e1 = entries[0]
    assert e1.rule_num == 1
    assert e1.rule_url == "https://azbyka.ru/pravo/1-apostolskoe-pravilo/"
    assert e1.group_title == "Правила святых апостолов"
    assert e1.group_url is None  # apostolic index has no separate group page
    assert "епископа" in e1.short_content.lower()


def test_apostolic_index_skips_top_recent_widget():
    # The page also has a "top viewed" widget at the bottom — entries must
    # come from <ul class="post-list"> at the top, not from the widget.
    html = (FIX / "index_apostolskie.html").read_text(encoding="utf-8")
    entries = parse_apostolic_index(html)
    urls = [e.rule_url for e in entries]
    # No duplicates
    assert len(urls) == len(set(urls))


def test_grouped_index_vselenskih_has_six_groups():
    html = (FIX / "index_vselenskih.html").read_text(encoding="utf-8")
    entries = parse_grouped_index(html, collection="vselenskih-soborov")
    groups = sorted({e.group_title for e in entries})
    # I, II, III, IV, V-VI, VII — 6 councils
    assert len(groups) == 6
    assert any("I Вселенский Собор – Никейский" in g for g in groups)
    assert any("V-VI Вселенский Собор" in g for g in groups)


def test_grouped_index_vselenskih_total_189_rules():
    html = (FIX / "index_vselenskih.html").read_text(encoding="utf-8")
    entries = parse_grouped_index(html, collection="vselenskih-soborov")
    assert len(entries) == 189


def test_grouped_index_carries_group_url():
    html = (FIX / "index_vselenskih.html").read_text(encoding="utf-8")
    entries = parse_grouped_index(html, collection="vselenskih-soborov")
    nikejskij = [e for e in entries if e.group_title.startswith("I Вселенский Собор – Никейский")]
    assert all(e.group_url == "https://azbyka.ru/pravo/pervyj-vselenskij-sobor-nikejskij/"
               for e in nikejskij)


def test_collection_field_stamped_on_every_entry():
    ap_html = (FIX / "index_apostolskie.html").read_text(encoding="utf-8")
    ap_entries = parse_apostolic_index(ap_html)
    assert all(e.collection == "apostolskie" for e in ap_entries)

    vs_html = (FIX / "index_vselenskih.html").read_text(encoding="utf-8")
    vs_entries = parse_grouped_index(vs_html, collection="vselenskih-soborov")
    assert all(e.collection == "vselenskih-soborov" for e in vs_entries)


def test_grouped_index_svyatootecheskie_13_groups():
    html = (FIX / "index_svyatootecheskie.html").read_text(encoding="utf-8")
    entries = parse_grouped_index(html, collection="svyatootecheskie")
    groups = {e.group_title for e in entries}
    assert len(groups) == 13
    assert "Правила свт. Василия Великого (†379)" in groups
    vasily = [e for e in entries if e.group_title == "Правила свт. Василия Великого (†379)"]
    # Vasily has 92 canonical rules
    assert len(vasily) == 92


def test_index_entry_short_content_strips_trailing_newline():
    html = (FIX / "index_apostolskie.html").read_text(encoding="utf-8")
    e1 = parse_apostolic_index(html)[0]
    assert not e1.short_content.endswith("\n")
    assert not e1.short_content.startswith(" ")
