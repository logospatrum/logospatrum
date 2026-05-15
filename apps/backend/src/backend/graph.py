"""LangGraph + deepagents graph: Sonnet main + Haiku search subagent."""
from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI

from .config import settings
from .prompts import MAIN_AGENT_PROMPT, SEARCH_AGENT_PROMPT
from .tools.list_authors import list_authors
from .tools.list_works import list_works
from .tools.expand_concept import expand_concept
from .tools.lexical_search import lexical_search
from .tools.semantic_search import semantic_search
from .tools.read_passage import read_passage


main_model = ChatOpenAI(
    api_key=settings.timeweb_ai_key,
    base_url=settings.timeweb_base_url,
    model=settings.main_agent_model,
    temperature=0.2,
)

search_model = ChatOpenAI(
    api_key=settings.timeweb_ai_key,
    base_url=settings.timeweb_base_url,
    model=settings.search_agent_model,
    temperature=0.1,
)


search_subagent = {
    "name": "search",
    "description": "Searches the patristic corpus. Delegate when you need citations.",
    "system_prompt": SEARCH_AGENT_PROMPT,
    "tools": [lexical_search, semantic_search,
              list_authors, list_works, expand_concept],
    "model": search_model,
}


agent = create_deep_agent(
    model=main_model,
    tools=[read_passage, list_authors, list_works, expand_concept,
           lexical_search, semantic_search],
    system_prompt=MAIN_AGENT_PROMPT,
    subagents=[search_subagent],
).with_config({"recursion_limit": 50})
