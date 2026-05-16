from pathlib import Path
from pipeline.pravo_rule import ParsedRule, Commentary, parse_rule_html

FIX = Path(__file__).parent / "fixtures" / "pravo"


def test_parse_apostolic_rule_1_basics():
    html = (FIX / "rule_ap1.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    assert isinstance(rule, ParsedRule)
    assert rule.rule_num == 1
    assert rule.h1 == "Правило 1"
    assert "епископа" in rule.short_content.lower()
    assert "Епископа да рукополагают два или три епископа" in rule.ru_text


def test_parse_apostolic_rule_1_commentaries():
    html = (FIX / "rule_ap1.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    authors = [c.author for c in rule.commentaries]
    # Must keep inline commentators
    assert "Зонара" in authors
    assert "Аристен" in authors
    assert "Вальсамон" in authors
    assert "Славянская кормчая" in authors
    # Must DROP "See by link" stubs
    assert not any("Никодим" in a for a in authors)
    assert not any("Пидалион" in a for a in authors)


def test_parse_apostolic_rule_1_commentary_text_kept_intact():
    html = (FIX / "rule_ap1.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    zonara = next(c for c in rule.commentaries if c.author == "Зонара")
    # First sentence sanity check
    assert "хиротониею" in zonara.text.lower()
    # Should not start with the author name (we store author separately)
    assert not zonara.text.lstrip().startswith("Зонара")


def test_parse_dvukratnyj_rule_15_has_mens_legislatoris():
    html = (FIX / "rule_dvukr15.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    authors = [c.author for c in rule.commentaries]
    assert "Матфей Властарь" in authors
    vlastar = next(c for c in rule.commentaries if c.author == "Матфей Властарь")
    assert "патриарх" in vlastar.text.lower() or "митрополит" in vlastar.text.lower()


def test_parse_dvukratnyj_rule_15_multi_paragraph_ru_text():
    # rule 15 has 2 <p> blocks in lang-ru — both must be kept, joined with \n\n
    html = (FIX / "rule_dvukr15.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    assert "\n\n" in rule.ru_text  # two paragraphs separated by blank line
    # Both halves must appear
    assert "святой Собор определил" in rule.ru_text
    assert "лжеепископов" in rule.ru_text


def test_parse_father_rule_vasilij_17():
    html = (FIX / "rule_vasilij17.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    assert rule.rule_num == 17
    assert rule.h1 == "Правило 17"
    assert len(rule.ru_text) > 50
    # Some commentaries always appear; if test fixture has none, this test is too weak
    assert isinstance(rule.commentaries, list)


def test_parse_rule_greek_dropped():
    html = (FIX / "rule_ap1.html").read_text(encoding="utf-8")
    rule = parse_rule_html(html)
    # No Greek glyphs leaked into ru_text
    assert "χειροτονείσθω" not in rule.ru_text
