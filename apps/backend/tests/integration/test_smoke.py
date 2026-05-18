"""Smoke test: verify agent cites only from read_passage results."""
import os
import re
import pytest
from langgraph_sdk import get_client

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
pytestmark = pytest.mark.integration


def _extract_tool_results(messages: list[dict], tool_name: str) -> list[str]:
    out: list[str] = []
    for m in messages:
        if m.get("type") == "tool" and m.get("name") == tool_name:
            content = m.get("content")
            if isinstance(content, str):
                out.append(content)
            elif isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and "text" in c:
                        out.append(c["text"])
                    elif isinstance(c, str):
                        out.append(c)
    return out


def _final_assistant_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("type") == "ai" or m.get("role") == "assistant":
            content = m.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def _extract_quotes(text: str) -> list[str]:
    out: list[str] = []
    for pat in (r"«([^»]{30,})»", r'"([^"]{30,})"'):
        out.extend(re.findall(pat, text))
    return out


@pytest.mark.asyncio
async def test_smoke_thematic_with_citations():
    client = get_client(url=BACKEND_URL)
    thread = await client.threads.create()
    run = await client.runs.wait(
        thread["thread_id"],
        "patristic",
        input={"messages": [{"role": "user",
                             "content": "Найди цитаты про послушание из Лествичника"}]},
    )
    messages = run.get("messages") if isinstance(run, dict) else run
    final = _final_assistant_text(messages)
    quotes = _extract_quotes(final)
    passages = _extract_tool_results(messages, "read_passage")

    for q in quotes:
        assert any(q.strip() in p for p in passages), (
            f"Quote not from read_passage: {q[:80]!r}"
        )
    assert len(passages) >= 1


@pytest.mark.asyncio
async def test_smoke_negative_query_says_not_found():
    client = get_client(url=BACKEND_URL)
    thread = await client.threads.create()
    run = await client.runs.wait(
        thread["thread_id"],
        "patristic",
        input={"messages": [{"role": "user",
                             "content": "Что Ницше писал о морали?"}]},
    )
    messages = run.get("messages") if isinstance(run, dict) else run
    final = _final_assistant_text(messages).lower()
    assert any(marker in final for marker in
               ["не найдено", "не в корпусе", "вне корпуса", "not in the corpus"])
