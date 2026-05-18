"""LangGraph + deepagents graph: Sonnet main + Haiku search subagent."""
from pathlib import Path

from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, MessagesState

from .budget.node import budget_record
from .config import settings
from .prompts import MAIN_AGENT_PROMPT, SEARCH_AGENT_PROMPT
from .skill_tools import build_skill_tools
from .skills_registry import scan_skills, render_skills_registry_for_prompt
from .styles_middleware import StyleMiddleware
from .styles_registry import scan_styles
from .tools.list_authors import list_authors
from .tools.list_works import list_works
from .tools.expand_concept import expand_concept
from .tools.lexical_search import lexical_search
from .tools.semantic_search import semantic_search
from .tools.read_passage import read_passage


main_model = ChatOpenAI(
    api_key=settings.openai_api_key,
    base_url=settings.openai_base_url,
    model=settings.main_agent_model,
    temperature=0.2,
    # Without streaming=True, ChatOpenAI does a synchronous request and dumps
    # the entire completion as a single chunk through .astream() — load-bearing
    # for token-by-token chat rendering, since langgraph's messages-tuple
    # stream mode only fires when the underlying model actually streams.
    streaming=True,
)

search_model = ChatOpenAI(
    api_key=settings.openai_api_key,
    base_url=settings.openai_base_url,
    model=settings.search_agent_model,
    temperature=0.1,
    streaming=True,
)


_SKILLS = scan_skills(Path(__file__).parent / "skills")
_SKILL_TOOLS = build_skill_tools(skills=_SKILLS)
_MAIN_PROMPT = MAIN_AGENT_PROMPT.replace(
    "{{SKILLS_REGISTRY}}",
    render_skills_registry_for_prompt(_SKILLS),
)

# Response-style presets — appended to MAIN_AGENT_PROMPT per-run by
# StyleMiddleware, based on `config.configurable.style_id`. The middleware is
# attached to the main agent only; the search subagent is unaffected (style
# does not bleed into retrieval).
_STYLES = scan_styles(Path(__file__).parent / "styles")


search_subagent = {
    "name": "search",
    "description": "Searches the patristic corpus. Delegate when you need citations.",
    "system_prompt": SEARCH_AGENT_PROMPT,
    "tools": [lexical_search, semantic_search,
              list_authors, list_works, expand_concept],
    "model": search_model,
}


_inner = create_deep_agent(
    model=main_model,
    tools=[read_passage, list_authors, list_works, expand_concept,
           lexical_search, semantic_search, *_SKILL_TOOLS],
    system_prompt=_MAIN_PROMPT,
    subagents=[search_subagent],
    middleware=[StyleMiddleware(_STYLES)],
).with_config({"recursion_limit": 50})  # preserved: deepagents needs depth for tool-use loops


# Wrap to attach a terminal accounting node. The inner deepagents graph runs
# first; once it returns its final state, `budget_record` reads the usage
# metadata from the messages, converts to RUB, and UPSERTs into budget_usage.
# Streaming: clients must pass `subgraphs=True` to see inner agent events
# (frontend Stream.tsx is updated in Task 5.2).
_wrapper = StateGraph(MessagesState)
_wrapper.add_node("agent_inner", _inner)
_wrapper.add_node("budget_record", budget_record)
_wrapper.set_entry_point("agent_inner")
_wrapper.add_edge("agent_inner", "budget_record")
_wrapper.add_edge("budget_record", END)
agent = _wrapper.compile().with_config({"recursion_limit": 50})
