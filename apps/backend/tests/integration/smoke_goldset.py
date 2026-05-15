"""Goldset smoke test — 1 random query per category, full transcript dump.

Picks one entry from each of: addressed, thematic, cross, negative.
Streams each run via langgraph_sdk with `subgraphs=True` so the search
subagent's internal messages and tool calls also flow into the transcript.

Pretty-prints every message (human / AI / tool result), every tool call
(main agent's `task` delegations + read_passage + the search subagent's
expand_concept / lexical_search / semantic_search). Writes both pretty
transcripts and raw JSON event dumps under `apps/backend/_smoke/`.

Run:
    cd apps/backend
    # in another terminal, langgraph dev --port 2024 --no-browser must be running
    PYTHONUTF8=1 .venv/Scripts/python -m tests.integration.smoke_goldset
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from langgraph_sdk import get_client

from backend.eval_runner import load_goldset


LANGGRAPH_URL = os.environ.get("LANGGRAPH_URL", "http://localhost:2024")
REPO_ROOT = Path(__file__).resolve().parents[4]
GOLDSET_PATH = REPO_ROOT / "tests" / "eval" / "gold.yaml"
OUT_DIR = Path(__file__).resolve().parents[2] / "_smoke"
SEED = int(os.environ.get("SMOKE_SEED", "42"))
CATEGORIES = ["addressed", "thematic", "cross", "negative"]


def _truncate(s: str, n: int) -> str:
    if not s:
        return ""
    s = str(s).replace("\n", " ").strip()
    return s if len(s) <= n else s[:n] + "…"


def _format_msg(m: dict, indent: str = "") -> list[str]:
    """Render one message as one or more lines of pretty text."""
    typ = m.get("type") or m.get("role") or "?"
    name = m.get("name") or ""
    lines: list[str] = []

    if typ == "human":
        content = m.get("content") or ""
        lines.append(f"{indent}USER ▷ {content}")
        return lines

    if typ == "ai":
        content = m.get("content")
        if isinstance(content, list):
            content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
        if content:
            lines.append(f"{indent}AI ▷ {_truncate(content, 600)}")
        tool_calls = m.get("tool_calls") or []
        for tc in tool_calls:
            tname = tc.get("name", "?")
            targs = tc.get("args") or {}
            try:
                targs_str = json.dumps(targs, ensure_ascii=False)
            except Exception:
                targs_str = str(targs)
            lines.append(f"{indent}  → {tname}({_truncate(targs_str, 400)})")
        if not content and not tool_calls:
            lines.append(f"{indent}AI ▷ <empty>")
        return lines

    if typ == "tool":
        content = m.get("content")
        if isinstance(content, list):
            content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
        lines.append(f"{indent}TOOL[{name}] ◁ {_truncate(content or '', 600)}")
        return lines

    lines.append(f"{indent}{typ}: {_truncate(json.dumps(m, ensure_ascii=False, default=str), 400)}")
    return lines


def _split_event(event: str) -> tuple[str, str]:
    """LangGraph v1 SSE with stream_subgraphs=True encodes namespace as
    `{mode}|{ns}`, e.g. `values|search:UUID`. Return (mode, ns_label).
    """
    if "|" in event:
        mode, ns = event.split("|", 1)
        return mode, ns
    return event, "main"


async def run_one(client, idx: int, entry, out_dir: Path) -> dict:
    print(f"\n=== [{idx}] {entry.category}: {entry.query} ===", flush=True)
    thread = await client.threads.create()
    thread_id = thread["thread_id"]

    raw_events: list[dict] = []
    pretty_lines: list[str] = [
        f"=== [{idx}] {entry.category} ===",
        f"Query: {entry.query}",
        f"Thread: {thread_id}",
        "",
    ]
    # Track last-seen messages count per namespace to print only deltas.
    last_count: dict[str, int] = defaultdict(int)

    async for chunk in client.runs.stream(
        thread_id,
        "patristic",
        input={"messages": [{"role": "user", "content": entry.query}]},
        stream_mode="values",
        stream_subgraphs=True,
    ):
        mode, ns_label = _split_event(chunk.event)
        raw_events.append({"event": chunk.event, "mode": mode, "ns": ns_label, "data": chunk.data})
        if mode != "values":
            continue
        data = chunk.data
        if not isinstance(data, dict):
            continue
        messages = data.get("messages") or []
        if not isinstance(messages, list):
            continue
        seen = last_count[ns_label]
        new_msgs = messages[seen:]
        if not new_msgs:
            continue
        last_count[ns_label] = len(messages)

        prefix = f"  [{ns_label}]" if ns_label != "main" else ""
        indent = "    " if ns_label != "main" else ""
        for m in new_msgs:
            if not isinstance(m, dict):
                continue
            for line in _format_msg(m, indent=indent):
                pretty_lines.append(f"{prefix} {line}".lstrip() if prefix else line)

    # Stream often ends before the run is fully committed. Wait for the
    # background run to actually finish, then pull the final state with
    # subgraphs so we capture the search subagent's full transcript too.
    try:
        runs = await client.runs.list(thread_id, limit=5)
        for r in runs:
            run_id = r.get("run_id") if isinstance(r, dict) else None
            if run_id:
                try:
                    await client.runs.join(thread_id, run_id)
                except Exception:
                    pass
    except Exception:
        pass

    try:
        states = await client.threads.get_state(thread_id, subgraphs=True)
    except Exception as e:
        states = {"error": str(e)}

    pretty_lines.append("")
    pretty_lines.append("--- FINAL STATE (after run.join, with subgraphs) ---")

    def _dump_state(state, ns_label: str = "main") -> None:
        if not isinstance(state, dict):
            pretty_lines.append(f"  [{ns_label}] {state!r}")
            return
        values = state.get("values") or {}
        msgs = values.get("messages") or []
        seen = last_count.get(ns_label, 0)
        prefix = f"  [{ns_label}]" if ns_label != "main" else ""
        indent = "    " if ns_label != "main" else ""
        for m in msgs[seen:]:
            if not isinstance(m, dict):
                continue
            for line in _format_msg(m, indent=indent):
                pretty_lines.append(f"{prefix} {line}".lstrip() if prefix else line)
        for sub in state.get("subgraph_states") or []:
            sub_ns = sub.get("namespace") if isinstance(sub, dict) else None
            sub_label = " > ".join(sub_ns) if isinstance(sub_ns, (list, tuple)) else "sub"
            _dump_state(sub.get("state") if isinstance(sub, dict) else sub, sub_label)

    _dump_state(states, "main")

    pretty_text = "\n".join(pretty_lines)
    print(pretty_text, flush=True)

    transcript_path = out_dir / f"q{idx}_{entry.category}.txt"
    transcript_path.write_text(pretty_text, encoding="utf-8")
    state_path = out_dir / f"q{idx}_{entry.category}_state.json"
    try:
        state_path.write_text(
            json.dumps(states, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
    except Exception as e:
        state_path.write_text(f"could not serialize state: {e}", encoding="utf-8")
    raw_path = out_dir / f"q{idx}_{entry.category}.json"
    raw_path.write_text(
        json.dumps(
            {"entry": entry.__dict__, "events": raw_events},
            ensure_ascii=False, indent=2, default=str,
        ),
        encoding="utf-8",
    )
    print(f"\nSaved transcript -> {transcript_path}")
    print(f"Saved raw events -> {raw_path}")
    return {"entry": entry, "raw_events": raw_events}


async def main() -> None:
    entries = load_goldset(str(GOLDSET_PATH))
    by_cat: dict[str, list] = defaultdict(list)
    for e in entries:
        by_cat[e.category].append(e)
    print(f"Loaded goldset: {len(entries)} entries across {sorted(by_cat)}")

    rng = random.Random(SEED)
    picked = []
    for cat in CATEGORIES:
        if by_cat[cat]:
            picked.append(rng.choice(by_cat[cat]))
        else:
            print(f"  [warn] no entries in category {cat}")
    print(f"Picked {len(picked)} queries with seed={SEED}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = get_client(url=LANGGRAPH_URL)

    for i, entry in enumerate(picked, 1):
        try:
            await run_one(client, i, entry, OUT_DIR)
        except Exception as e:
            print(f"  [error] {entry.category}: {e}", flush=True)
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
