from pathlib import Path

from backend.skills_registry import Skill, scan_skills, render_skills_registry_for_prompt


def test_scan_skills_empty_dir_returns_empty(tmp_path):
    assert scan_skills(tmp_path) == []


def test_scan_skills_parses_valid_frontmatter(tmp_path):
    (tmp_path / "apologetics.md").write_text(
        "---\nname: apologetics\ndescription: Use for X\n---\n# Apologetics\nbody text",
        encoding="utf-8",
    )
    skills = scan_skills(tmp_path)
    assert len(skills) == 1
    assert skills[0].name == "apologetics"
    assert skills[0].description == "Use for X"
    assert "# Apologetics" in skills[0].body
    assert "body text" in skills[0].body


def test_scan_skills_skips_missing_name(tmp_path):
    (tmp_path / "bad.md").write_text(
        "---\ndescription: only description, no name\n---\nbody",
        encoding="utf-8",
    )
    assert scan_skills(tmp_path) == []


def test_scan_skills_skips_missing_description(tmp_path):
    (tmp_path / "bad.md").write_text(
        "---\nname: only-name\n---\nbody",
        encoding="utf-8",
    )
    assert scan_skills(tmp_path) == []


def test_scan_skills_skips_no_frontmatter(tmp_path):
    (tmp_path / "noframe.md").write_text("# Just a heading\nno frontmatter at all", encoding="utf-8")
    assert scan_skills(tmp_path) == []


def test_scan_skills_ignores_non_md_files(tmp_path):
    (tmp_path / "x.txt").write_text("not markdown", encoding="utf-8")
    (tmp_path / "x.yaml").write_text("name: x\ndescription: x", encoding="utf-8")
    assert scan_skills(tmp_path) == []


def test_scan_skills_returns_sorted_by_path(tmp_path):
    (tmp_path / "zebra.md").write_text("---\nname: zebra\ndescription: z\n---\nb", encoding="utf-8")
    (tmp_path / "alpha.md").write_text("---\nname: alpha\ndescription: a\n---\nb", encoding="utf-8")
    skills = scan_skills(tmp_path)
    assert [s.name for s in skills] == ["alpha", "zebra"]


def test_render_skills_registry_returns_empty_for_no_skills():
    assert render_skills_registry_for_prompt([]) == ""


def test_render_skills_registry_formats_each_skill_as_line():
    skills = [
        Skill(name="apologetics", description="Use when challenged", body="...", path=Path("/x")),
        Skill(name="pastoral", description="Use for grief", body="...", path=Path("/y")),
    ]
    out = render_skills_registry_for_prompt(skills)
    assert "# Available skills" in out
    assert "invoke_skill(name)" in out
    assert "- apologetics: Use when challenged" in out
    assert "- pastoral: Use for grief" in out
