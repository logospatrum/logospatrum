"""scan_styles parses YAML frontmatter into a {name: Style} dict."""
from pathlib import Path

from backend.styles_registry import Style, scan_styles


def test_scan_styles_empty_dir_returns_empty_dict(tmp_path):
    assert scan_styles(tmp_path) == {}


def test_scan_styles_parses_valid_frontmatter(tmp_path):
    (tmp_path / "academic.md").write_text(
        "---\nname: academic\ndescription: Rigorous register\n---\n## Body\nrules text",
        encoding="utf-8",
    )
    styles = scan_styles(tmp_path)
    assert set(styles) == {"academic"}
    s = styles["academic"]
    assert s.name == "academic"
    assert s.description == "Rigorous register"
    assert "## Body" in s.body
    assert "rules text" in s.body


def test_scan_styles_empty_body_preserved(tmp_path):
    """`normal.md` ships with only frontmatter — body must be empty (not raise)."""
    (tmp_path / "normal.md").write_text(
        "---\nname: normal\ndescription: No framing\n---\n",
        encoding="utf-8",
    )
    styles = scan_styles(tmp_path)
    assert styles["normal"].body.strip() == ""


def test_scan_styles_skips_missing_name(tmp_path):
    (tmp_path / "bad.md").write_text(
        "---\ndescription: only description\n---\nbody",
        encoding="utf-8",
    )
    assert scan_styles(tmp_path) == {}


def test_scan_styles_skips_missing_description(tmp_path):
    (tmp_path / "bad.md").write_text(
        "---\nname: only-name\n---\nbody",
        encoding="utf-8",
    )
    assert scan_styles(tmp_path) == {}


def test_scan_styles_skips_no_frontmatter(tmp_path):
    (tmp_path / "x.md").write_text("# Heading without frontmatter", encoding="utf-8")
    assert scan_styles(tmp_path) == {}


def test_scan_styles_ignores_non_md(tmp_path):
    (tmp_path / "x.txt").write_text("not markdown", encoding="utf-8")
    (tmp_path / "x.yaml").write_text("name: x\ndescription: x", encoding="utf-8")
    assert scan_styles(tmp_path) == {}


def test_real_styles_dir_has_four_canonical_presets():
    """Live check: the shipped styles directory contains the four expected presets."""
    styles_dir = Path(__file__).resolve().parents[2] / "src" / "backend" / "styles"
    styles = scan_styles(styles_dir)
    assert set(styles) == {"normal", "academic", "explanatory", "concise"}
    # normal must have empty body so middleware skips the append
    assert styles["normal"].body.strip() == ""
    # the other three must have non-empty body — they're the actual style instructions
    for name in ("academic", "explanatory", "concise"):
        assert styles[name].body.strip(), f"style {name!r} must have non-empty body"
