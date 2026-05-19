import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from backend.budget import node, storage


def _ai(model: str, input_tokens: int, output_tokens: int) -> AIMessage:
    msg = AIMessage(content="ok")
    msg.response_metadata = {"model": model}
    msg.usage_metadata = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }
    return msg


@pytest.mark.asyncio
async def test_node_records_sonnet_cost(db_clean):
    state = {
        "messages": [
            HumanMessage(content="..."),
            _ai("anthropic/claude-sonnet-4-6", 10_000, 1_000),
            # 10_000 * 405/1M + 1_000 * 2025/1M = 4.05 + 2.025 = 6.075
        ]
    }
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:abc"}}
    await node.budget_record(state, cfg)
    assert await storage.get_used_rub("cookie:abc", storage._today_msk()) == pytest.approx(6.075, rel=1e-3)
    assert await storage.get_used_rub("__global_month", storage._this_month_msk()) == pytest.approx(6.075, rel=1e-3)


@pytest.mark.asyncio
async def test_node_records_against_every_subject_key(db_clean):
    """New shape: frontend proxy injects `subject_keys` list. Every key in
    the list MUST get the same delta, so cookie-reset abusers still
    accumulate against ip: and fp: buckets."""
    state = {
        "messages": [
            HumanMessage(content="..."),
            _ai("anthropic/claude-sonnet-4-6", 10_000, 1_000),  # 6.075 ₽
        ]
    }
    cfg: RunnableConfig = {
        "configurable": {
            "subject_keys": ["cookie:abc", "ip:1.2.3.4", "fp:hashhash"],
        }
    }
    await node.budget_record(state, cfg)
    today = storage._today_msk()
    assert await storage.get_used_rub("cookie:abc", today) == pytest.approx(6.075, rel=1e-3)
    assert await storage.get_used_rub("ip:1.2.3.4", today) == pytest.approx(6.075, rel=1e-3)
    assert await storage.get_used_rub("fp:hashhash", today) == pytest.approx(6.075, rel=1e-3)
    # __global_month gets it exactly once, not per-key.
    assert await storage.get_used_rub("__global_month", storage._this_month_msk()) == pytest.approx(6.075, rel=1e-3)


@pytest.mark.asyncio
async def test_node_sums_subagent_haiku_and_main_sonnet(db_clean):
    state = {
        "messages": [
            HumanMessage(content="..."),
            _ai("claude-haiku-4-5", 50_000, 5_000),   # 5.4 + 2.7 = 8.1
            _ai("claude-sonnet-4-6", 20_000, 2_000),  # 8.1 + 4.05 = 12.15
            # sum = 20.25
        ]
    }
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:x"}}
    await node.budget_record(state, cfg)
    assert await storage.get_used_rub("cookie:x", storage._today_msk()) == pytest.approx(20.25, rel=1e-3)


@pytest.mark.asyncio
async def test_node_falls_back_to_unknown_subject(db_clean):
    state = {"messages": [_ai("claude-sonnet-4-6", 1000, 0)]}
    await node.budget_record(state, {})  # no configurable
    assert await storage.get_used_rub("__unknown__", storage._today_msk()) == pytest.approx(0.405, rel=1e-3)


@pytest.mark.asyncio
async def test_node_swallows_db_errors(monkeypatch, db_clean):
    async def _boom(*a, **kw):
        raise RuntimeError("db gone")
    monkeypatch.setattr("backend.budget.storage.add_usage", _boom)
    state = {"messages": [_ai("claude-sonnet-4-6", 1000, 0)]}
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:abc"}}
    # Must not raise.
    await node.budget_record(state, cfg)


@pytest.mark.asyncio
async def test_node_no_op_when_guard_disabled(monkeypatch, db_clean):
    monkeypatch.setattr("backend.config.settings.budget_guard_enabled", False)
    state = {"messages": [_ai("claude-sonnet-4-6", 1000, 1000)]}
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:abc"}}
    await node.budget_record(state, cfg)
    # Nothing written
    assert await storage.get_used_rub("cookie:abc", storage._today_msk()) == 0.0
    assert await storage.get_used_rub("__global_month", storage._this_month_msk()) == 0.0
