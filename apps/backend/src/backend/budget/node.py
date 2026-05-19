"""Post-run accounting node. Runs at the tail of the agent graph.

Reads every AIMessage's usage_metadata + response_metadata.model, converts to
RUB via pricing.cost_rub(), upserts into budget_usage for the day-bucket of
subject_key AND for __global_month.

CONTRACT: this node MUST NOT raise. Accounting failure must never cancel a
successful agent run.
"""

import logging
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from . import pricing, storage
from ..config import settings

log = logging.getLogger(__name__)


async def budget_record(state: dict[str, Any], config: RunnableConfig) -> dict:
    if not settings.budget_guard_enabled:
        return {}

    try:
        configurable = config.get("configurable") or {}
        # Frontend proxy injects `subject_keys: [cookie:..., ip:..., fp:...]`.
        # Old-shape `subject_key: "cookie:..."` is accepted as a single-element
        # fallback for in-flight runs during a rolling deploy and for tests.
        keys = configurable.get("subject_keys")
        if not keys:
            single = configurable.get("subject_key")
            keys = [single] if single else ["__unknown__"]

        total_rub = 0.0
        for msg in state.get("messages", []):
            if not isinstance(msg, AIMessage):
                continue
            usage = getattr(msg, "usage_metadata", None) or {}
            in_tok = int(usage.get("input_tokens") or 0)
            out_tok = int(usage.get("output_tokens") or 0)
            if in_tok == 0 and out_tok == 0:
                continue
            model = (
                (msg.response_metadata or {}).get("model")
                or (msg.response_metadata or {}).get("model_name")
                or "__default__"
            )
            total_rub += pricing.cost_rub(model, in_tok, out_tok)

        if total_rub > 0:
            for key in keys:
                await storage.add_usage(key, storage._today_msk(), total_rub)
            await storage.add_usage("__global_month", storage._this_month_msk(), total_rub)
    except Exception:
        log.exception("budget_record failed; swallowing to avoid run cancellation")

    return {}
