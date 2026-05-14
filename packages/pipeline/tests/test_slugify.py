import pytest
from pipeline.slugify import slugify


@pytest.mark.parametrize("inp,expected", [
    ("Аврелий Августин, блаженный", "avrelij_avgustin_blazhennyj"),
    ("Иоанн Лествичник, преподобный", "ioann_lestvichnik_prepodobnyj"),
    ("Брянчанинов Игнатий, святитель", "brjanchaninov_ignatij_svjatitel"),
    ("Лествица", "lestvica"),
    ("Аскетические опыты, Части 1-2", "asketicheskie_opyty_chasti_1_2"),
    ("Слово 4. О блаженном послушании", "slovo_4_o_blazhennom_poslushanii"),
    ("Алфавитный_указатель_на_книгу", "alfavitnyj_ukazatel_na_knigu"),
    ("Платон", "platon"),
    ("Аристотель", "aristotel"),
])
def test_slugify_known_inputs(inp: str, expected: str) -> None:
    assert slugify(inp) == expected


def test_slugify_idempotent() -> None:
    s = slugify("Иоанн Златоуст, святитель")
    assert slugify(s) == s


def test_slugify_empty() -> None:
    assert slugify("") == ""
    assert slugify("   ") == ""


def test_slugify_only_punctuation() -> None:
    assert slugify("!!!---???") == ""


def test_slugify_truncates_to_max_length() -> None:
    long = "очень_длинное_название_" * 20
    out = slugify(long, max_length=80)
    assert len(out) <= 80
    assert not out.endswith("_")
