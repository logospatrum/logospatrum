"""Retrieval-only bench. Runs semantic_search + lexical_search on goldset queries
without invoking the agent or any LLM.

Usage:
    set POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@host:port/patristic
    PYTHONUTF8=1 .venv/Scripts/python scripts/bench_retrieval.py \
        --label baseline --output bench/baseline-<ts>.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[0]
# Make backend package importable
sys.path.insert(0, str(REPO_ROOT / "apps" / "backend" / "src"))

# IMPORTANT: import order matters — backend.config reads POSTGRES_DSN at import time
assert "POSTGRES_DSN" in os.environ, "Set POSTGRES_DSN before running this script"

from backend.eval_runner import GoldEntry, load_goldset  # noqa: E402


def _author_of(citation: str) -> str:
    return citation.split("/", 1)[0] if "/" in citation else citation


def _work_of(citation: str) -> str:
    parts = citation.split("/")
    return parts[1] if len(parts) >= 2 else ""


def _chapter_of(citation: str) -> int | None:
    parts = citation.split("/")
    if len(parts) >= 3:
        try:
            return int(parts[2])
        except ValueError:
            return None
    return None


def parse_top_authors(top: list[dict]) -> set[str]:
    return {_author_of(r["citation"]) for r in top}


def parse_top_work_chapters(top: list[dict]) -> set[tuple[str, int | None]]:
    return {(_work_of(r["citation"]), _chapter_of(r["citation"])) for r in top}


def classify_pass(
    entry: GoldEntry,
    semantic_top: list[dict],
    lexical_top: list[dict],
    low_conf_threshold: float = 0.45,
) -> bool | None:
    """Returns:
        True  — query passes its rule based on retrieval alone
        False — query fails
        None  — rule needs LLM (adversarial_safe), skip in this bench
    """
    rule = entry.passing
    combined_authors = parse_top_authors(semantic_top) | parse_top_authors(lexical_top)
    combined_wc = parse_top_work_chapters(semantic_top) | parse_top_work_chapters(lexical_top)

    if rule == "adversarial_safe":
        return None

    if rule == "at_least_one_match":
        if not entry.expected_authors:
            return bool(semantic_top or lexical_top)
        return bool(combined_authors & set(entry.expected_authors))

    if rule == "any_match":
        if not entry.expected_citations:
            return bool(semantic_top or lexical_top)
        for exp in entry.expected_citations:
            for w, c in combined_wc:
                if w == exp["work"] and ("chapter" not in exp or c == exp["chapter"]):
                    return True
        return False

    if rule == "at_least_two_authors":
        if not entry.expected_authors:
            return False
        return len(combined_authors & set(entry.expected_authors)) >= 2

    if rule == "empty_or_low_confidence":
        # Proxy: if best semantic score below threshold → "low confidence" pass
        if not semantic_top:
            return True
        best_score = max(r.get("score", 0.0) for r in semantic_top)
        return best_score < low_conf_threshold

    return False


async def _run_one(entry: GoldEntry, top_k: int = 20) -> dict:
    # Lazy import — happens after POSTGRES_DSN is set in env
    from backend.tools.semantic_search import semantic_search
    from backend.tools.lexical_search import lexical_search

    t0 = time.perf_counter()
    sem = await semantic_search.ainvoke({"query": entry.query, "limit": top_k})
    sem_ms = (time.perf_counter() - t0) * 1000.0

    t0 = time.perf_counter()
    lex = await lexical_search.ainvoke({"query": entry.query, "limit": top_k})
    lex_ms = (time.perf_counter() - t0) * 1000.0

    return {
        "query": entry.query,
        "category": entry.category,
        "passing": entry.passing,
        "expected_authors": entry.expected_authors,
        "expected_citations": entry.expected_citations,
        "semantic_top": [{"citation": r["citation"], "score": r.get("score")} for r in sem],
        "lexical_top": [{"citation": r["citation"], "score": r.get("score")} for r in lex],
        "semantic_latency_ms": sem_ms,
        "lexical_latency_ms": lex_ms,
    }


async def main_async(args: argparse.Namespace) -> int:
    goldset_path = REPO_ROOT / "tests" / "eval" / "gold.yaml"
    entries = load_goldset(str(goldset_path))
    print(f"[bench] {len(entries)} queries from {goldset_path}", flush=True)

    per_query: list[dict] = []
    for i, entry in enumerate(entries, 1):
        record = await _run_one(entry, top_k=args.top_k)
        record["pass"] = classify_pass(
            entry,
            semantic_top=[{**r, "score": r["score"] or 0.0} for r in record["semantic_top"]],
            lexical_top=record["lexical_top"],
            low_conf_threshold=args.low_conf_threshold,
        )
        per_query.append(record)
        print(f"[{i:>3}/{len(entries)}] {entry.category:<11} pass={record['pass']} "
              f"sem={record['semantic_latency_ms']:.0f}ms lex={record['lexical_latency_ms']:.0f}ms",
              flush=True)

    # Summary
    by_cat: dict[str, dict] = {}
    sem_lats: list[float] = []
    lex_lats: list[float] = []
    for r in per_query:
        cat = r["category"]
        d = by_cat.setdefault(cat, {"total": 0, "pass": 0, "skip": 0})
        d["total"] += 1
        if r["pass"] is None:
            d["skip"] += 1
        elif r["pass"]:
            d["pass"] += 1
        sem_lats.append(r["semantic_latency_ms"])
        lex_lats.append(r["lexical_latency_ms"])
    for d in by_cat.values():
        scored = d["total"] - d["skip"]
        d["pass_rate"] = (d["pass"] / scored) if scored else None

    def pct(xs: list[float], p: float) -> float:
        if not xs:
            return 0.0
        xs2 = sorted(xs)
        idx = min(len(xs2) - 1, int(round(p * (len(xs2) - 1))))
        return xs2[idx]

    summary = {
        "by_category": by_cat,
        "latency_ms": {
            "semantic_p50": pct(sem_lats, 0.50),
            "semantic_p95": pct(sem_lats, 0.95),
            "semantic_p99": pct(sem_lats, 0.99),
            "lexical_p50": pct(lex_lats, 0.50),
            "lexical_p95": pct(lex_lats, 0.95),
            "lexical_p99": pct(lex_lats, 0.99),
        },
    }

    out = {
        "label": args.label,
        "ts_utc": datetime.now(timezone.utc).isoformat(),
        "dsn_host": os.environ["POSTGRES_DSN"].split("@", 1)[-1].split("/", 1)[0],
        "top_k": args.top_k,
        "low_conf_threshold": args.low_conf_threshold,
        "summary": summary,
        "per_query": per_query,
    }
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[bench] wrote {out_path}", flush=True)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--label", required=True, help="Label, e.g. baseline | after-migration | after-corpus")
    p.add_argument("--output", required=True, help="Output JSON path")
    p.add_argument("--top-k", type=int, default=20)
    p.add_argument("--low-conf-threshold", type=float, default=0.45)
    args = p.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
