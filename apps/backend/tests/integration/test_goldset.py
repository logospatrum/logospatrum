"""Goldset acceptance test (Task 39).

Loads tests/eval/gold.yaml, runs each query through the live LangGraph agent,
extracts read_passage citations, evaluates per-entry, reports thresholds.

REQUIRES: langgraph dev server running on $LANGGRAPH_URL with full corpus indexed.

Run: pytest apps/backend/tests/integration/test_goldset.py -v -s
"""
import os
import json
import re
from pathlib import Path

import pytest
from langgraph_sdk import get_client

from backend.eval_runner import load_goldset, evaluate, summary

LANGGRAPH_URL = os.environ.get("LANGGRAPH_URL", "http://localhost:2024")
GOLDSET_PATH = Path(__file__).resolve().parents[3] / "tests" / "eval" / "gold.yaml"

pytestmark = pytest.mark.integration

# Acceptance thresholds (per plan header)
THRESHOLDS = {
    "addressed": 0.80,
    "thematic": 0.60,
    "cross": 0.70,
    "negative": 1.00,
}


def _extract_citations(messages: list[dict]) -> list[str]:
    """Pull every read_passage citation argument from AI tool_calls in transcript."""
    out: list[str] = []
    for m in messages:
        if m.get("type") == "ai":
            for tc in m.get("tool_calls", []) or []:
                if tc.get("name") == "read_passage":
                    args = tc.get("args") or {}
                    cit = args.get("citation")
                    if cit:
                        out.append(cit)
    return out


def _final_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("type") == "ai":
            content = m.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


@pytest.mark.asyncio
async def test_goldset_meets_thresholds():
    entries = load_goldset(str(GOLDSET_PATH))
    assert len(entries) >= 50, f"Goldset must have ≥50 entries; got {len(entries)}"

    client = get_client(url=LANGGRAPH_URL)
    results = []

    for i, entry in enumerate(entries, 1):
        print(f"[{i}/{len(entries)}] {entry.category}: {entry.query[:60]}", flush=True)
        thread = await client.threads.create()
        run = await client.runs.wait(
            thread["thread_id"],
            "patristic",
            input={"messages": [{"role": "user", "content": entry.query}]},
        )
        messages = run.get("messages") if isinstance(run, dict) else run
        cits = _extract_citations(messages)
        text = _final_text(messages)
        r = evaluate(entry, cits, text)
        results.append(r)
        print(f"   {'PASS' if r.passed else 'FAIL'}: {r.reason[:120]}", flush=True)

    s = summary(results)
    print("\n=== Goldset summary ===", flush=True)
    print(json.dumps(s, ensure_ascii=False, indent=2), flush=True)

    # Persist detailed report for post-hoc analysis
    report_path = Path(__file__).resolve().parents[2] / "_goldset_report.json"
    report_path.write_text(json.dumps({
        "summary": s,
        "thresholds": THRESHOLDS,
        "details": [
            {
                "query": r.entry.query,
                "category": r.entry.category,
                "passed": r.passed,
                "reason": r.reason,
                "citations_used": r.citations_used,
            }
            for r in results
        ],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Full report → {report_path}", flush=True)

    failures: list[str] = []
    for cat, thr in THRESHOLDS.items():
        if cat not in s:
            continue
        if s[cat]["pass_rate"] < thr:
            failures.append(f"{cat}: {s[cat]['pass_rate']:.2%} < {thr:.0%}")
    assert not failures, "Goldset thresholds missed:\n" + "\n".join(failures)
