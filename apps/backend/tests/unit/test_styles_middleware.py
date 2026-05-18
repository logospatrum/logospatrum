"""StyleMiddleware appends the style body to the system message based on
`config.configurable.style_id`. Empty body = no mutation. Unknown style_id
= fall back to default ('normal')."""
from __future__ import annotations
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from langchain.agents.middleware.types import ModelRequest
from langchain_core.messages import SystemMessage

from backend import styles_middleware as sm_module
from backend.styles_middleware import StyleMiddleware
from backend.styles_registry import Style


def _make_request(system_text: str = "BASE PROMPT") -> ModelRequest:
    """Minimal ModelRequest for testing the middleware's mutation."""
    return ModelRequest(
        model=MagicMock(),
        messages=[],
        system_message=SystemMessage(content=system_text),
    )


def _styles(**bodies: str) -> dict[str, Style]:
    return {
        name: Style(name=name, description=f"d-{name}", body=body, path=Path("/x"))
        for name, body in bodies.items()
    }


@pytest.fixture
def mock_config(monkeypatch):
    """Monkeypatch get_config inside the middleware module to return a controlled dict."""
    holder = {"value": {}}

    def fake_get_config():
        return holder["value"]

    monkeypatch.setattr(sm_module, "get_config", fake_get_config)
    return holder


def test_inject_appends_style_body_when_style_id_set(mock_config):
    mock_config["value"] = {"configurable": {"style_id": "academic"}}
    mw = StyleMiddleware(_styles(normal="", academic="ACADEMIC INSTRUCTIONS"))
    req = _make_request("BASE")
    out = mw._inject(req)
    assert "BASE" in out.system_message.content
    assert "ACADEMIC INSTRUCTIONS" in out.system_message.content
    assert out.system_message.content == "BASE\n\nACADEMIC INSTRUCTIONS"


def test_inject_skips_when_style_body_empty(mock_config):
    """`normal` ships with empty body — system_message must stay untouched."""
    mock_config["value"] = {"configurable": {"style_id": "normal"}}
    mw = StyleMiddleware(_styles(normal=""))
    req = _make_request("BASE")
    out = mw._inject(req)
    assert out.system_message.content == "BASE"


def test_inject_falls_back_to_default_when_style_id_missing(mock_config):
    """No style_id in configurable → use default ('normal'), which has empty body."""
    mock_config["value"] = {"configurable": {}}
    mw = StyleMiddleware(_styles(normal="", academic="A"))
    req = _make_request("BASE")
    out = mw._inject(req)
    assert out.system_message.content == "BASE"


def test_inject_falls_back_to_default_when_style_id_unknown(mock_config):
    """Unknown style_id → fall back to default ('normal'), not crash."""
    mock_config["value"] = {"configurable": {"style_id": "doesnotexist"}}
    mw = StyleMiddleware(_styles(normal="", academic="A"))
    req = _make_request("BASE")
    out = mw._inject(req)
    assert out.system_message.content == "BASE"


def test_inject_handles_missing_configurable(mock_config):
    """Config without a `configurable` key shouldn't crash."""
    mock_config["value"] = {}
    mw = StyleMiddleware(_styles(normal="", academic="A"))
    req = _make_request("BASE")
    out = mw._inject(req)
    assert out.system_message.content == "BASE"


def test_inject_handles_no_runnable_context(monkeypatch):
    """If get_config raises (called outside a runnable), use default — don't propagate."""
    def fake_raise():
        raise RuntimeError("Called get_config outside of a runnable context")
    monkeypatch.setattr(sm_module, "get_config", fake_raise)
    mw = StyleMiddleware(_styles(normal="", academic="A"))
    req = _make_request("BASE")
    out = mw._inject(req)
    assert out.system_message.content == "BASE"


def test_inject_handles_missing_system_message(mock_config):
    """If system_message is None (shouldn't happen but be defensive), use just the body."""
    mock_config["value"] = {"configurable": {"style_id": "academic"}}
    mw = StyleMiddleware(_styles(normal="", academic="A"))
    req = ModelRequest(model=MagicMock(), messages=[], system_message=None)
    out = mw._inject(req)
    assert out.system_message.content == "A"


def test_wrap_model_call_passes_mutated_request_to_handler(mock_config):
    mock_config["value"] = {"configurable": {"style_id": "academic"}}
    mw = StyleMiddleware(_styles(normal="", academic="ACAD"))
    req = _make_request("BASE")
    seen = {}

    def handler(r):
        seen["content"] = r.system_message.content
        return "ok"

    result = mw.wrap_model_call(req, handler)
    assert result == "ok"
    assert seen["content"] == "BASE\n\nACAD"


@pytest.mark.asyncio
async def test_awrap_model_call_passes_mutated_request_to_handler(mock_config):
    mock_config["value"] = {"configurable": {"style_id": "academic"}}
    mw = StyleMiddleware(_styles(normal="", academic="ACAD"))
    req = _make_request("BASE")
    seen = {}

    async def handler(r):
        seen["content"] = r.system_message.content
        return "ok"

    result = await mw.awrap_model_call(req, handler)
    assert result == "ok"
    assert seen["content"] == "BASE\n\nACAD"
