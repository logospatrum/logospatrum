"""StyleMiddleware: inject the per-run response-style block into the model's
system message.

How it wires up:
- `create_deep_agent(..., middleware=[StyleMiddleware(_STYLES)])` registers
  this on the main agent only. The search subagent (constructed as a SubAgent
  dict) doesn't receive it, so style does not bleed into retrieval.
- On every LLM call in the ReAct loop, deepagents builds a `ModelRequest` with
  `system_message = SystemMessage(<MAIN_AGENT_PROMPT>)`. We intercept via
  `(a)wrap_model_call`, read `style_id` from `config.configurable`, look up the
  style body, and APPEND it to the system message content (single system msg,
  not two — Anthropic API takes one `system` param).
- Empty body (e.g. `normal.md`) → no mutation, model sees only MAIN_AGENT_PROMPT.
  This is the back-compat path: legacy clients with no `style_id` fall through
  to `normal` and get the bare procedural prompt.
"""
from __future__ import annotations
from typing import Awaitable, Callable

from langchain.agents.middleware.types import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import SystemMessage
from langgraph.config import get_config

from .styles_registry import Style


class StyleMiddleware(AgentMiddleware):
    """Append the active style block to the system message before each LLM call."""

    def __init__(self, styles: dict[str, Style], default: str = "normal") -> None:
        super().__init__()
        self._styles = styles
        self._default = default

    def _resolve_style_id(self) -> str:
        try:
            cfg = get_config()
        except RuntimeError:
            # Defensive: get_config raises if called outside a runnable context
            # (e.g. unit tests that invoke the middleware directly). Fall back.
            return self._default
        configurable = (cfg.get("configurable") or {}) if cfg else {}
        return configurable.get("style_id") or self._default

    def _inject(self, request: ModelRequest) -> ModelRequest:
        style_id = self._resolve_style_id()
        style = self._styles.get(style_id) or self._styles.get(self._default)
        if style is None:
            return request
        body = style.body.strip()
        if not body:
            return request
        base = request.system_message.content if request.system_message else ""
        return request.override(
            system_message=SystemMessage(
                content=f"{base}\n\n{body}" if base else body
            )
        )

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._inject(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._inject(request))
