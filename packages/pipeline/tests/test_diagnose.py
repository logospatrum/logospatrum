from pathlib import Path
from pipeline.diagnose import analyze_corpus, Issue


def _make_tree(root: Path, layout: dict) -> None:
    for name, content in layout.items():
        path = root / name
        if isinstance(content, dict):
            path.mkdir(parents=True, exist_ok=True)
            _make_tree(path, content)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")


def test_analyze_normal_author(tmp_path: Path) -> None:
    _make_tree(tmp_path, {
        "Августин": {"Исповедь": {"003_I.md": "x" * 200, "004_II.md": "x" * 200}},
    })
    reports = analyze_corpus(tmp_path)
    assert len(reports) == 1
    r = reports[0]
    assert r.work_count == 1
    assert r.md_count == 2
    assert not r.issues


def test_analyze_single_chapter_long(tmp_path: Path) -> None:
    _make_tree(tmp_path, {
        "Златоуст": {"Беседа": {"002_Беседа.md": "x" * 12000}},
    })
    reports = analyze_corpus(tmp_path)
    assert Issue.SINGLE_CHAPTER_LONG in reports[0].issues


def test_analyze_empty_work(tmp_path: Path) -> None:
    _make_tree(tmp_path, {
        "Исаак_Сирин": {"Слова_подвижнические": {}},
    })
    reports = analyze_corpus(tmp_path)
    assert Issue.EMPTY_WORK in reports[0].issues
