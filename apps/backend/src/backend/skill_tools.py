"""Skill tools: invoke_skill bound to a pre-scanned skill list.

Only invoke_skill is exposed. The registry of available skills is already
injected into the main-agent system prompt at construction time, so there
is no runtime list_skills tool — that would just duplicate context.
"""
from __future__ import annotations

from langchain_core.tools import BaseTool, tool

from .skills_registry import Skill


def build_skill_tools(*, skills: list[Skill]) -> list[BaseTool]:
    """Build the invoke_skill tool bound to a pre-scanned skill list.

    The returned tool reads from the closure-captured skill list, so calls
    are O(1) and don't touch disk.
    """
    by_name = {s.name: s for s in skills}

    @tool
    def invoke_skill(name: str) -> str:
        """Load the full content of a domain skill (posture + forbidden moves).

        Call this BEFORE composing an answer when the user's question matches
        one of the skills listed in the 'Available skills' section of your
        system prompt — e.g. an apologetic challenge or a personal pastoral
        query. The skill body tells you how to position the answer; standard
        retrieval tools (semantic_search, lexical_search, read_passage) still
        do the actual citation work.

        Args:
            name: skill name from the registry, e.g. 'apologetics' or 'pastoral'.

        Returns:
            The skill's full markdown content, or a string error if not found
            (never raises — keeps parallel tool calls from being cancelled).

        Keywords: load skill, posture, frame discipline, apologetics, pastoral.
        """
        s = by_name.get(name)
        if s is None:
            return f"Skill {name!r} not found. Available: {sorted(by_name)}"
        return s.body

    return [invoke_skill]
