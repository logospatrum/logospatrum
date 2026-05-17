from pathlib import Path

from backend.skills_registry import Skill
from backend.skill_tools import build_skill_tools


def _make_skills():
    return [
        Skill(name="apologetics", description="d1", body="APOLOGETICS BODY", path=Path("/a")),
        Skill(name="pastoral", description="d2", body="PASTORAL BODY", path=Path("/p")),
    ]


def test_build_skill_tools_returns_single_tool():
    tools = build_skill_tools(skills=_make_skills())
    assert len(tools) == 1
    assert tools[0].name == "invoke_skill"


def test_invoke_skill_returns_body_for_known_name():
    [invoke_skill] = build_skill_tools(skills=_make_skills())
    result = invoke_skill.invoke({"name": "apologetics"})
    assert result == "APOLOGETICS BODY"


def test_invoke_skill_returns_error_string_for_unknown_name():
    """Must NOT raise — protects from langgraph parallel-tool-call cancellation."""
    [invoke_skill] = build_skill_tools(skills=_make_skills())
    result = invoke_skill.invoke({"name": "nonexistent"})
    assert isinstance(result, str)
    assert "not found" in result
    # Should list available so the agent can recover.
    assert "apologetics" in result
    assert "pastoral" in result


def test_invoke_skill_with_empty_registry_returns_error_string():
    [invoke_skill] = build_skill_tools(skills=[])
    result = invoke_skill.invoke({"name": "anything"})
    assert isinstance(result, str)
    assert "not found" in result
