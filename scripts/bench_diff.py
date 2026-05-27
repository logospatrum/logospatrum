"""Diff two bench_retrieval JSON files.

Usage:
    python scripts/bench_diff.py bench/baseline-X.json bench/after-migration-Y.json \
        --output bench/diff-phase1.md
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def _topk_set(per_query_entry: dict, source: str) -> set[str]:
    return {r["citation"] for r in per_query_entry.get(source, [])}


def _index_by_query(per_query: list[dict]) -> dict[str, dict]:
    return {r["query"]: r for r in per_query}


def summarize_diff(baseline: dict, target: dict, top_k_for_overlap: int = 10) -> str:
    lines: list[str] = []
    lines.append(f"# Bench diff: `{baseline.get('label')}` → `{target.get('label')}`")
    lines.append("")
    lines.append(f"- Baseline run: {baseline.get('ts_utc')}  ({baseline.get('dsn_host')})")
    lines.append(f"- Target run:   {target.get('ts_utc')}  ({target.get('dsn_host')})")
    lines.append("")

    # Per-category pass-rate
    lines.append("## Pass-rate by category")
    lines.append("")
    lines.append("| Category | Baseline | Target | Δ |")
    lines.append("|---|---:|---:|---:|")
    cats = sorted(set(baseline["summary"]["by_category"]) | set(target["summary"]["by_category"]))
    for cat in cats:
        b = baseline["summary"]["by_category"].get(cat, {})
        t = target["summary"]["by_category"].get(cat, {})
        br = b.get("pass_rate")
        tr = t.get("pass_rate")
        delta = (tr - br) if (br is not None and tr is not None) else None
        b_str = f"{br:.2f}" if br is not None else "n/a"
        t_str = f"{tr:.2f}" if tr is not None else "n/a"
        d_str = f"{delta:+.2f}" if delta is not None else "n/a"
        lines.append(f"| {cat} | {b_str} | {t_str} | {d_str} |")
    lines.append("")

    # Latency
    lines.append("## Latency (ms)")
    lines.append("")
    lines.append("| Metric | Baseline | Target | Δ |")
    lines.append("|---|---:|---:|---:|")
    for key in ["semantic_p50", "semantic_p95", "semantic_p99",
                "lexical_p50", "lexical_p95", "lexical_p99"]:
        b = baseline["summary"]["latency_ms"].get(key, 0.0)
        t = target["summary"]["latency_ms"].get(key, 0.0)
        d = t - b
        lines.append(f"| {key} | {b:.1f} | {t:.1f} | {d:+.1f} |")
    lines.append("")

    # Top-K overlap
    lines.append(f"## Top-{top_k_for_overlap} overlap (Jaccard)")
    lines.append("")
    base_idx = _index_by_query(baseline.get("per_query", []))
    target_idx = _index_by_query(target.get("per_query", []))
    common = sorted(set(base_idx) & set(target_idx))
    sem_overlaps: list[float] = []
    lex_overlaps: list[float] = []
    rows: list[tuple[str, float, float]] = []
    for q in common:
        bs = {r["citation"] for r in base_idx[q]["semantic_top"][:top_k_for_overlap]}
        ts_ = {r["citation"] for r in target_idx[q]["semantic_top"][:top_k_for_overlap]}
        bl = {r["citation"] for r in base_idx[q]["lexical_top"][:top_k_for_overlap]}
        tl = {r["citation"] for r in target_idx[q]["lexical_top"][:top_k_for_overlap]}
        sj = jaccard(bs, ts_)
        lj = jaccard(bl, tl)
        sem_overlaps.append(sj)
        lex_overlaps.append(lj)
        rows.append((q, sj, lj))

    if sem_overlaps:
        lines.append(f"- Mean semantic top-{top_k_for_overlap} Jaccard: {sum(sem_overlaps)/len(sem_overlaps):.3f}")
        lines.append(f"- Mean lexical top-{top_k_for_overlap} Jaccard:  {sum(lex_overlaps)/len(lex_overlaps):.3f}")
    lines.append("")
    lines.append("### Per-query (worst 10 by semantic Jaccard)")
    lines.append("")
    rows.sort(key=lambda r: r[1])
    lines.append("| Query | sem-Jaccard | lex-Jaccard |")
    lines.append("|---|---:|---:|")
    for q, sj, lj in rows[:10]:
        lines.append(f"| {q[:60]} | {sj:.3f} | {lj:.3f} |")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("baseline")
    p.add_argument("target")
    p.add_argument("--output", required=True)
    p.add_argument("--top-k", type=int, default=10)
    args = p.parse_args()
    baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    target = json.loads(Path(args.target).read_text(encoding="utf-8"))
    md = summarize_diff(baseline, target, top_k_for_overlap=args.top_k)
    Path(args.output).write_text(md, encoding="utf-8")
    print(f"[diff] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
