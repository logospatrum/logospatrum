"""Verify MAIN_AGENT_PROMPT has the skills registry sentinel + substitutes correctly."""
from pathlib import Path

from backend.prompts import MAIN_AGENT_PROMPT
from backend.skills_registry import scan_skills, render_skills_registry_for_prompt


def test_main_agent_prompt_has_skills_registry_sentinel():
    assert "{{SKILLS_REGISTRY}}" in MAIN_AGENT_PROMPT, (
        "MAIN_AGENT_PROMPT must contain the {{SKILLS_REGISTRY}} sentinel so "
        "graph.py can substitute the scanned skills registry at startup."
    )


def test_substitution_replaces_sentinel():
    """End-to-end: scan real skills, render, substitute — sentinel must disappear."""
    skills_dir = Path(__file__).resolve().parents[2] / "src" / "backend" / "skills"
    skills = scan_skills(skills_dir)
    registry_block = render_skills_registry_for_prompt(skills)
    final = MAIN_AGENT_PROMPT.replace("{{SKILLS_REGISTRY}}", registry_block)
    assert "{{SKILLS_REGISTRY}}" not in final
    # If skills exist, the registry header appears; if not, the block is empty
    # and the sentinel was just removed.
    if skills:
        assert "# Available skills" in final


def test_existing_curly_braces_in_prompt_are_preserved():
    """MAIN_AGENT_PROMPT has literal {} (e.g. '{found: false, ...}'). str.replace
    must not touch them — only .format() would, which is exactly why we DON'T
    use .format() here.
    """
    skills_dir = Path(__file__).resolve().parents[2] / "src" / "backend" / "skills"
    skills = scan_skills(skills_dir)
    final = MAIN_AGENT_PROMPT.replace(
        "{{SKILLS_REGISTRY}}", render_skills_registry_for_prompt(skills)
    )
    # The read_passage rule mentions `{found: false, error: ...}` literally.
    assert "{found: false" in final
