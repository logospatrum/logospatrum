import pytest
from pipeline.pravo_authors import (
    AuthorRef,
    KANONICHESKOE_PRAVO,
    resolve_father,
)


def test_kanonicheskoe_pravo_constants():
    assert KANONICHESKOE_PRAVO.slug == "kanonicheskoe_pravo"
    assert KANONICHESKOE_PRAVO.name_display == "Каноническое право"
    assert KANONICHESKOE_PRAVO.global_section == "Каноническое право"


def test_resolve_father_existing_author():
    ref = resolve_father("Правила свт. Василия Великого (†379)")
    assert ref.slug == "vasilij_velikij_svjatitel"
    assert ref.name_display == "Василий Великий, святитель"
    assert ref.years_of_life == "†379"
    assert ref.global_section == "Православная библиотека Святых отцов и церковных писателей"


def test_resolve_father_new_author():
    ref = resolve_father("Правила свт. Амфилохия Иконийского (†395)")
    assert ref.slug == "amfilohij_ikonijskij_svjatitel"
    assert ref.name_display == "Амфилохий Иконийский, святитель"
    assert ref.years_of_life == "†395"


def test_resolve_father_petr_aleksandrijskij_disambiguates():
    # Note: "свмч." not "свт.", and our existing Dionysius is also свмч.;
    # ensure we don't accidentally collapse the two.
    ref = resolve_father("Правила свмч. Петра Александрийского (†311)")
    assert ref.slug == "petr_aleksandrijskij_svjashhennomuchenik"


def test_resolve_father_dionisij_reuse_despite_rank_diff():
    # Source says "свт." but our existing slug uses "священномученик".
    # Reuse path is dictated by the explicit map, not by string match.
    ref = resolve_father("Правила свт. Дионисия Александрийского (†265)")
    assert ref.slug == "dionisij_aleksandrijskij_svjashhennomuchenik"


def test_resolve_father_feofil_disambiguates_against_antiohijskij():
    # Existing DB has feofil_antiohijskij_svjatitel (2nd c.); /pravo/ entry is
    # Феофил Александрийский (5th c.). They must NOT collapse.
    ref = resolve_father("Правила Феофила, архиепископа Александрийского (†412)")
    assert ref.slug == "feofil_aleksandrijskij_arhiepiskop"


def test_resolve_father_unknown_raises():
    with pytest.raises(KeyError):
        resolve_father("Правила свт. Кого-то Неизвестного (†500)")
