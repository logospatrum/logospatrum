from pathlib import Path
from pipeline.paragraphs import parse_md, split_paragraphs, MIN_PARA_CHARS


FIXTURES = Path(__file__).parent / "fixtures" / "sample_md"


def test_parse_md_extracts_frontmatter() -> None:
    parsed = parse_md(FIXTURES / "normal_chapter.md")
    assert parsed.frontmatter["author"] == "Аврелий Августин, блаженный"
    assert parsed.frontmatter["book_title"] == "Исповедь"
    assert int(parsed.frontmatter["chapter_number"]) == 4
    assert parsed.frontmatter["source_url"].startswith("https://azbyka.ru")


def test_paragraphs_filters_noise() -> None:
    parsed = parse_md(FIXTURES / "normal_chapter.md")
    paras = parsed.paragraphs
    assert len(paras) == 4
    assert paras[0].startswith("Первый абзац")
    assert paras[-1].startswith("Четвёртый абзац")
    assert not any("— 42 —" == p for p in paras)


def test_paragraphs_min_length_threshold() -> None:
    parsed = parse_md(FIXTURES / "with_noise.md")
    for p in parsed.paragraphs:
        assert len(p) >= MIN_PARA_CHARS
    assert len(parsed.paragraphs) == 2


def test_paragraphs_single_chapter_handles() -> None:
    parsed = parse_md(FIXTURES / "single_chapter_long.md")
    assert len(parsed.paragraphs) == 2


def test_split_paragraphs_fallback_single_newline() -> None:
    text = "Первый длинный абзац номер один говорит о добродетели и её плодах.\nВторой длинный абзац номер два следует тут же без двойного переноса между ними."
    paras = split_paragraphs(text)
    assert len(paras) == 2
