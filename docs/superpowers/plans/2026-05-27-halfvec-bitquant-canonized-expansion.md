# Halfvec + bit-quant migration & canonized corpus expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate prod DB from `vector(1024)` to `halfvec(1024)` + bit-quantized HNSW with two-stage rerank, then expand the corpus from `featured_bogoslov` (~92 authors) to `canonized` filter on azbyka.ru.

**Architecture:** Four phases with explicit human review gates. Phase 0 collects baseline metrics. Phase 1 migrates the schema and backend in place on prod. Phase 2 scrapes new corpus to local filesystem only. Phase 3 streams paragraphs + embeddings directly into prod via DSN, with indexes dropped during bulk insert and rebuilt after.

**Tech Stack:** Postgres 16 + pgvector ≥ 0.7 (halfvec, binary_quantize, bit_hamming_ops), bge-m3 (1024-dim normalized embeddings), FastAPI / deepagents backend, typer pipeline CLI, Next.js frontend. Migration is online for lexical search and offline for vector search during HNSW rebuild.

**Spec:** [docs/superpowers/specs/2026-05-27-halfvec-bitquant-canonized-expansion-design.md](../specs/2026-05-27-halfvec-bitquant-canonized-expansion-design.md)

---

## File Map

| Path | Role | Action |
|---|---|---|
| `infra/migrations/003_halfvec_bitquant.sql` | Forward migration: ALTER TYPE + new bit-quant HNSW | Create |
| `infra/migrations/001_init.sql` | Fresh-install schema | Patch (`vector(1024)` → `halfvec(1024)`) |
| `apps/backend/src/backend/tools/semantic_search.py` | Vector search tool | Rewrite SQL to two-stage rerank |
| `apps/backend/tests/unit/test_semantic_search.py` | Unit tests | Adjust fixture / new assertion on rerank order |
| `packages/pipeline/pipeline/embed.py` | Embedding ingest | Cast vectors to halfvec on INSERT, switch `_create_indexes` to bit-quant DDL |
| `packages/pipeline/pipeline/__main__.py` | typer CLI | Add `ingest-azbyka` subcommand |
| `packages/pipeline/pipeline/ingest_azbyka.py` | New module | Orchestrates Scraper → Downloader → MarkdownConverter for a list of authors |
| `scripts/bench_retrieval.py` | Token-free retrieval bench | Create |
| `scripts/bench_diff.py` | Bench JSON differ | Create |
| `scripts/canonized_diff.py` | Compute canonized authors \ prod authors | Create |
| `docs/superpowers/notes/2026-05-27-pipeline-idempotency-audit.md` | Audit findings | Create |
| `bench/baseline-<UTC>.json` | Phase 0 output | Generated |
| `bench/after-migration-<UTC>.json` | Phase 1 output | Generated |
| `bench/after-corpus-<UTC>.json` | Phase 3 output | Generated |

---

## Phase 0 — Pre-flight

### Task 1: Baseline `pg_dump` of prod

**Files:**
- Output: `/opt/logospatrum/backups/patristic-pre-halfvec-<UTC>.dump` (on VPS)

- [ ] **Step 1: SSH to VPS, create backups dir if missing**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 'mkdir -p /opt/logospatrum/backups'
```

- [ ] **Step 2: Run pg_dump in custom (compressed) format**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec infra-postgres-1 pg_dump -U postgres -d patristic -Fc \
  > /opt/logospatrum/backups/patristic-pre-halfvec-${TS}.dump
ls -lh /opt/logospatrum/backups/
'
```

Expected: a file of size 4-10 GB.

- [ ] **Step 3: Verify backup is restorable (dry-run list)**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
ls /opt/logospatrum/backups/patristic-pre-halfvec-*.dump | tail -1 | xargs -I {} \
  docker exec -i infra-postgres-1 pg_restore --list < {} | head -20
'
```

Expected: TOC printout starting with `; Archive created at ...` and listing tables.

- [ ] **Step 4: Record dump filename in plan checklist below**

Filename to record: `_______________________________________________` (fill after Step 2).

---

### Task 2: Pipeline idempotency audit document

**Files:**
- Create: `docs/superpowers/notes/2026-05-27-pipeline-idempotency-audit.md`

- [ ] **Step 1: Read source of all pipeline subcommands and document skip behavior**

Files to read:
- `packages/pipeline/pipeline/scrape.py` (class `Scraper`)
- `packages/pipeline/pipeline/download.py` (class `Downloader`)
- `packages/pipeline/pipeline/markdown_convert.py` (class `MarkdownConverter`)
- `packages/pipeline/pipeline/paragraphs.py` (function `run` and helpers)
- `packages/pipeline/pipeline/embed.py` (functions `run`, `_load_done_keys`)

- [ ] **Step 2: Write the audit document**

```markdown
# Pipeline Idempotency Audit — 2026-05-27

For each subcommand: input source, output target, skip predicate, what happens when re-run after partial completion.

## scrape.py (class Scraper — not wired to CLI)
- Input: `libraries_file` URLs → `output/<author>/<work>.md` shells
- Skip predicate: file exists check inside `_scrape_work` / equivalent
- Re-run behavior: ...

## download.py (class Downloader — not wired to CLI)
...

## markdown_convert.py (class MarkdownConverter — not wired to CLI)
...

## paragraphs (typer cmd `paragraphs`)
- Idempotency: UPSERT for authors/works/chapters; DELETE-then-INSERT per chapter for paragraphs
- Concern: re-runs rewrite unchanged chapters (expensive on big corpus)
- Mitigation needed for Phase 3: add filter to skip work_slugs already present in prod

## embed (typer cmd `embed`)
- Resumable via `_load_done_keys` (in-memory set of PK tuples)
- `--from-scratch` TRUNCATEs embeddings (only when explicit)
- Drops + recreates HNSW + GIN at run boundaries (will change to bit-quant in Phase 1)

## concepts-bootstrap, enrich
- Out of scope for this plan
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-05-27-pipeline-idempotency-audit.md
git commit -m "docs: pipeline idempotency audit for halfvec migration prep"
```

---

### Task 3: Write `scripts/bench_retrieval.py` (TDD)

Token-free bench that runs `semantic_search` and `lexical_search` directly against a configured DSN. No agent, no LLM.

**Files:**
- Create: `scripts/bench_retrieval.py`
- Create: `scripts/tests/test_bench_retrieval.py`

- [ ] **Step 1: Decide module layout**

The script imports backend tools directly. It must:
- Set `POSTGRES_DSN` env var before importing `backend.config` (same pattern as `apps/backend/tests/conftest.py:8-18`).
- Use `backend.eval_runner.load_goldset` to read `tests/eval/gold.yaml`.
- Call `backend.tools.semantic_search.semantic_search.ainvoke({...})` and `backend.tools.lexical_search.lexical_search.ainvoke({...})`.
- Use `time.perf_counter()` for latency.
- Save output JSON next to `bench/<label>-<UTC>.json`.

- [ ] **Step 2: Write the failing test for pass-rule logic**

Create `scripts/tests/test_bench_retrieval.py`:

```python
"""Tests for bench_retrieval pure logic (no DB, no embeddings)."""
import sys
from pathlib import Path

# Make scripts/ importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bench_retrieval import (
    classify_pass,
    parse_top_authors,
    parse_top_work_chapters,
)
from backend.eval_runner import GoldEntry


def test_at_least_one_match_via_topk_authors():
    entry = GoldEntry(
        query="x",
        category="addressed",
        expected_authors=["ioann_lestvichnik_prepodobnyj"],
        passing="at_least_one_match",
    )
    top = [
        {"citation": "ioann_lestvichnik_prepodobnyj/lestvica/0001/p1"},
        {"citation": "vasilij_velikij_svjatitel/work_x/0001/p1"},
    ]
    assert classify_pass(entry, semantic_top=top, lexical_top=[]) is True


def test_at_least_one_match_fails_when_expected_not_in_topk():
    entry = GoldEntry(
        query="x",
        category="addressed",
        expected_authors=["ioann_lestvichnik_prepodobnyj"],
        passing="at_least_one_match",
    )
    top = [
        {"citation": "grigorij_palama_svjatitel/triady/0001/p1"},
    ]
    assert classify_pass(entry, semantic_top=top, lexical_top=top) is False


def test_any_match_checks_work_and_chapter():
    entry = GoldEntry(
        query="x",
        category="thematic",
        expected_citations=[{"work": "lestvica", "chapter": 4}],
        passing="any_match",
    )
    top_hit = [{"citation": "ioann/lestvica/0004/p2"}]
    top_miss_chapter = [{"citation": "ioann/lestvica/0001/p2"}]
    assert classify_pass(entry, semantic_top=top_hit, lexical_top=[]) is True
    assert classify_pass(entry, semantic_top=top_miss_chapter, lexical_top=[]) is False


def test_at_least_two_authors():
    entry = GoldEntry(
        query="x",
        category="cross",
        expected_authors=["a", "b", "c"],
        passing="at_least_two_authors",
    )
    top = [
        {"citation": "a/wa/0001/p1"},
        {"citation": "b/wb/0001/p1"},
        {"citation": "z/wz/0001/p1"},
    ]
    assert classify_pass(entry, semantic_top=top, lexical_top=[]) is True


def test_adversarial_safe_is_skipped():
    entry = GoldEntry(
        query="x",
        category="adversarial",
        passing="adversarial_safe",
    )
    result = classify_pass(entry, semantic_top=[], lexical_top=[])
    assert result is None  # explicit "not applicable in retrieval-only bench"


def test_empty_or_low_confidence_uses_score_threshold():
    entry = GoldEntry(
        query="x",
        category="negative",
        passing="empty_or_low_confidence",
    )
    low = [{"citation": "a/wa/0001/p1", "score": 0.30}]
    high = [{"citation": "a/wa/0001/p1", "score": 0.85}]
    assert classify_pass(entry, semantic_top=low, lexical_top=[], low_conf_threshold=0.45) is True
    assert classify_pass(entry, semantic_top=high, lexical_top=[], low_conf_threshold=0.45) is False
```

- [ ] **Step 3: Run tests, confirm failure**

```bash
cd C:\Users\79819\PycharmProjects\christian_rag
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -m pytest scripts/tests/test_bench_retrieval.py -v
```

Expected: ImportError — `bench_retrieval` module does not exist.

- [ ] **Step 4: Implement the pure-logic functions in `scripts/bench_retrieval.py`**

```python
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
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
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
```

- [ ] **Step 5: Run tests to verify pure-logic functions pass**

```bash
cd C:\Users\79819\PycharmProjects\christian_rag
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -m pytest scripts/tests/test_bench_retrieval.py -v
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/bench_retrieval.py scripts/tests/test_bench_retrieval.py
git commit -m "feat(bench): token-free retrieval bench script"
```

---

### Task 4: Write `scripts/bench_diff.py` (TDD)

Compares two bench JSON files (e.g. baseline vs after-migration) and emits a markdown diff.

**Files:**
- Create: `scripts/bench_diff.py`
- Create: `scripts/tests/test_bench_diff.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for bench_diff pure logic."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bench_diff import jaccard, summarize_diff


def test_jaccard_empty_sets():
    assert jaccard(set(), set()) == 1.0  # both empty = identical


def test_jaccard_disjoint():
    assert jaccard({"a"}, {"b"}) == 0.0


def test_jaccard_partial_overlap():
    assert jaccard({"a", "b", "c", "d"}, {"a", "b", "x", "y"}) == 2 / 6


def test_summarize_includes_pass_rate_deltas():
    base = {
        "summary": {
            "by_category": {
                "addressed": {"total": 10, "pass": 8, "pass_rate": 0.8, "skip": 0},
                "thematic": {"total": 5, "pass": 3, "pass_rate": 0.6, "skip": 0},
            },
            "latency_ms": {"semantic_p50": 50.0, "semantic_p95": 200.0,
                           "semantic_p99": 400.0, "lexical_p50": 20.0,
                           "lexical_p95": 80.0, "lexical_p99": 150.0},
        },
        "per_query": [],
    }
    target = {
        "summary": {
            "by_category": {
                "addressed": {"total": 10, "pass": 7, "pass_rate": 0.7, "skip": 0},
                "thematic": {"total": 5, "pass": 4, "pass_rate": 0.8, "skip": 0},
            },
            "latency_ms": {"semantic_p50": 60.0, "semantic_p95": 250.0,
                           "semantic_p99": 500.0, "lexical_p50": 22.0,
                           "lexical_p95": 90.0, "lexical_p99": 160.0},
        },
        "per_query": [],
    }
    md = summarize_diff(base, target)
    assert "addressed" in md
    assert "-0.10" in md or "-10" in md  # delta surfaced somehow
    assert "thematic" in md
    assert "p95" in md
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -m pytest scripts/tests/test_bench_diff.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `scripts/bench_diff.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify**

```bash
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -m pytest scripts/tests/test_bench_diff.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/bench_diff.py scripts/tests/test_bench_diff.py
git commit -m "feat(bench): markdown diff tool for bench JSON outputs"
```

---

### Task 5: Run baseline bench against prod

**Files:**
- Output: `bench/baseline-<UTC>.json`

- [ ] **Step 1: Get PG_PASSWORD from VPS**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 'grep PG_PASSWORD /opt/logospatrum/.env'
```

Copy the value. Use it for the next step. Do NOT echo it into shell history.

- [ ] **Step 2: Verify network reachability to prod Postgres**

```bash
# Replace <PG_PASSWORD> with value from Step 1
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -c "
import psycopg
import os
dsn = os.environ['POSTGRES_DSN']
with psycopg.connect(dsn, connect_timeout=10) as c:
    c.execute('SELECT count(*) FROM embeddings'); print(c.fetchone())
"
```

Set `POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic` (via `set` on PowerShell or `setx` for persistent; use `set` so it lives only this shell).

Expected output: `(2000361,)` (or close — the row count from prod).

- [ ] **Step 3: Run the bench**

```bash
mkdir bench 2>nul
set POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic
set BUDGET_GUARD_ENABLED=false
PYTHONUTF8=1 apps/backend/.venv/Scripts/python scripts/bench_retrieval.py ^
  --label baseline ^
  --output bench/baseline.json
```

Expected: 53 lines of progress + final summary JSON printed. Wall time ~5-15 min (semantic embedding of 53 queries on CPU dominates).

- [ ] **Step 4: Inspect summary**

Open `bench/baseline.json` and verify:
- Per-category counts: `addressed ≈ 18`, `thematic`, `cross`, `negative`, `adversarial`.
- `adversarial` entries have `pass: null` (skipped, as designed).
- `latency_ms` reasonable (`semantic_p50` < 500 ms, `lexical_p50` < 100 ms — anything 10× higher suggests network or pool issue).

- [ ] **Step 5: Commit the baseline result**

```bash
git add bench/baseline.json
git commit -m "bench(phase0): baseline retrieval metrics from prod (pre-migration)"
```

⏸ **PHASE 0 STOP** — user reviews baseline metrics before approving Phase 1.

---

## Phase 1 — Migration

### Task 6: Fresh pre-migration `pg_dump`

**Files:**
- Output: `/opt/logospatrum/backups/patristic-pre-migration-<UTC>.dump` (on VPS)

- [ ] **Step 1: Dump prod again (separate snapshot from Task 1)**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec infra-postgres-1 pg_dump -U postgres -d patristic -Fc \
  > /opt/logospatrum/backups/patristic-pre-migration-${TS}.dump
echo "WROTE: /opt/logospatrum/backups/patristic-pre-migration-${TS}.dump"
ls -lh /opt/logospatrum/backups/
'
```

- [ ] **Step 2: Record the exact filename below**

Filename: `_______________________________________________`

---

### Task 7: Create `infra/migrations/003_halfvec_bitquant.sql`

**Files:**
- Create: `infra/migrations/003_halfvec_bitquant.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 003_halfvec_bitquant.sql
-- Convert embeddings.vector from vector(1024) to halfvec(1024) and replace
-- the HNSW cosine index with a bit-quantized HNSW index for top-K candidate
-- selection. Semantic search becomes two-stage: bit-Hamming top-K → halfvec
-- cosine rerank.
--
-- Required: pgvector >= 0.7 (provides halfvec, binary_quantize, bit_hamming_ops).
-- Verify: SELECT extversion FROM pg_extension WHERE extname='vector';

BEGIN;

-- Step 1: cast existing vectors to halfvec in place. ALTER TYPE with USING
-- rewrites all heap pages, so this is the slow step (~10-20 min on 2M rows).
ALTER TABLE embeddings
  ALTER COLUMN vector TYPE halfvec(1024)
  USING vector::halfvec(1024);

-- Step 2: drop the old HNSW index on the float32 vector.
DROP INDEX IF EXISTS embeddings_vector_idx;

-- Step 3: build a bit-quantized HNSW index. The expression
-- `binary_quantize(vector)::bit(1024)` produces a 1024-bit signature; HNSW
-- traverses these with Hamming distance (operator <~>).
CREATE INDEX embeddings_vector_idx
  ON embeddings
  USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;

-- Refresh planner stats; not transactional.
ANALYZE embeddings;
```

- [ ] **Step 2: Smoke-check the SQL syntax locally against a throwaway DB**

```bash
# Spin up a temp container to validate DDL syntax (the migration applies cleanly).
docker run --rm -d --name pgvector-test -p 55433:5432 ^
  -e POSTGRES_PASSWORD=test pgvector/pgvector:pg16
timeout /t 3 /nobreak >nul
docker exec pgvector-test psql -U postgres -d postgres -c "CREATE EXTENSION vector;"
docker exec pgvector-test psql -U postgres -d postgres -c "CREATE TABLE embeddings(vector vector(1024));"
docker exec -i pgvector-test psql -U postgres -d postgres < infra/migrations/003_halfvec_bitquant.sql
docker exec pgvector-test psql -U postgres -d postgres -c "\d embeddings"
docker stop pgvector-test
```

Expected: no SQL errors. `\d embeddings` shows `vector halfvec(1024)`.

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/003_halfvec_bitquant.sql
git commit -m "feat(migrations): 003 halfvec + bit-quant HNSW"
```

---

### Task 8: Patch `infra/migrations/001_init.sql` for fresh installs

**Files:**
- Modify: `infra/migrations/001_init.sql`

- [ ] **Step 1: Open the init SQL and locate the `vector` column**

```bash
grep -n "vector(1024)" infra/migrations/001_init.sql
```

- [ ] **Step 2: Replace the column type**

Apply this exact edit (the surrounding 4 lines are shown for context):

```diff
-    vector vector(1024),
+    vector halfvec(1024),
```

- [ ] **Step 3: Verify fresh-install on temp DB works**

```bash
docker run --rm -d --name pgvector-init -p 55434:5432 -e POSTGRES_PASSWORD=test pgvector/pgvector:pg16
timeout /t 3 /nobreak >nul
docker exec -i pgvector-init psql -U postgres < infra/migrations/001_init.sql
docker exec pgvector-init psql -U postgres -c "\d embeddings"
docker stop pgvector-init
```

Expected: `vector halfvec(1024)`.

- [ ] **Step 4: Commit**

```bash
git add infra/migrations/001_init.sql
git commit -m "feat(migrations): switch fresh init schema to halfvec(1024)"
```

---

### Task 9: Update `semantic_search.py` for two-stage rerank (TDD)

**Files:**
- Modify: `apps/backend/src/backend/tools/semantic_search.py`
- Modify: `apps/backend/tests/unit/test_semantic_search.py`

- [ ] **Step 1: Update test fixture to insert halfvec via SQL cast**

Open `apps/backend/tests/unit/test_semantic_search.py`. The fixture currently inserts via:

```python
"INSERT INTO embeddings (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical) "
"VALUES (%s,%s,%s,1,%s,to_tsvector('russian',%s))",
[t[0], t[1], t[2], v.tolist(), t[3]],
```

Change the placeholder to cast to halfvec:

```python
"INSERT INTO embeddings (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical) "
"VALUES (%s,%s,%s,1,%s::halfvec(1024),to_tsvector('russian',%s))",
[t[0], t[1], t[2], v.tolist(), t[3]],
```

- [ ] **Step 2: Recreate `patristic_test` schema with the patched 001_init.sql**

```bash
docker exec patristic-postgres-dev psql -U postgres -c "DROP DATABASE IF EXISTS patristic_test;"
docker exec patristic-postgres-dev psql -U postgres -c "CREATE DATABASE patristic_test;"
docker cp infra/migrations/001_init.sql patristic-postgres-dev:/tmp/001_init.sql
docker cp infra/migrations/002_abuse_budget.sql patristic-postgres-dev:/tmp/002_abuse_budget.sql
docker exec patristic-postgres-dev psql -U postgres -d patristic_test -f /tmp/001_init.sql
docker exec patristic-postgres-dev psql -U postgres -d patristic_test -f /tmp/002_abuse_budget.sql
```

- [ ] **Step 3: Run existing semantic_search tests, expect failure (rerank SQL not yet implemented)**

```bash
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_semantic_search.py -v
```

The tests may pass if the old single-stage SQL still works against halfvec (operator `<=>` works on halfvec too). That's OK — we'll add a new test for the rerank path specifically.

- [ ] **Step 4: Add a new test asserting the two-stage rerank ordering**

Add to `tests/unit/test_semantic_search.py`:

```python
@pytest.mark.asyncio
async def test_semantic_search_uses_two_stage_rerank(db_with_real_vectors, fake_model, monkeypatch):
    """Verify the SQL issued contains binary_quantize for stage 1 and halfvec cosine for stage 2."""
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    async def _stub():
        return svc
    monkeypatch.setattr(ss_module, "_get_service", _stub)

    captured: list[str] = []
    real_execute = None

    async def spy_execute(self, sql, *args, **kwargs):
        captured.append(sql if isinstance(sql, str) else str(sql))
        return await real_execute(self, sql, *args, **kwargs)

    import psycopg
    real_execute = psycopg.AsyncCursor.execute  # type: ignore[attr-defined]
    monkeypatch.setattr(psycopg.AsyncCursor, "execute", spy_execute)

    try:
        await ss_module.semantic_search.ainvoke({"query": "Послушание"})
    finally:
        await svc.stop()

    joined = " ".join(captured)
    assert "binary_quantize" in joined
    assert "bit_hamming_ops" in joined or "<~>" in joined
    assert "halfvec" in joined or "<=>" in joined  # rerank distance present
```

- [ ] **Step 5: Run the new test — expect failure**

```bash
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_semantic_search.py::test_semantic_search_uses_two_stage_rerank -v
```

Expected: FAIL — assertion on `binary_quantize` substring.

- [ ] **Step 6: Rewrite the SQL in `semantic_search.py` to two-stage form**

Replace the `sql = ...` block (lines 67-78) and `params = ...` (line 79) with:

```python
    # Two-stage retrieval with bit-quantized HNSW:
    # 1) HNSW finds top-N candidates by Hamming distance over binary-quantized vectors
    # 2) Exact halfvec cosine reranks within those candidates
    candidate_pool = max(100, limit * 5)
    sql = f"""
        WITH cand AS (
          SELECT e.work_slug, e.chapter_num, e.para_num, e.window_size, e.vector
          FROM embeddings e
          JOIN works w ON w.slug = e.work_slug
          JOIN authors a ON a.slug = w.author_slug
          {where}
          ORDER BY binary_quantize(e.vector)::bit(1024)
                   <~> binary_quantize(%s::halfvec(1024))::bit(1024)
          LIMIT %s
        )
        SELECT w2.author_slug, cand.work_slug, cand.chapter_num, cand.para_num, cand.window_size,
               LEFT(p.text, 200) AS snippet,
               1 - (cand.vector <=> %s::halfvec(1024)) AS score
        FROM cand
        JOIN works w2 ON w2.slug = cand.work_slug
        JOIN paragraphs p ON p.work_slug=cand.work_slug AND p.chapter_num=cand.chapter_num AND p.para_num=cand.para_num
        ORDER BY cand.vector <=> %s::halfvec(1024)
        LIMIT %s
    """
    params = where_params + [vec, candidate_pool, vec, vec, limit]
```

Also remove the `SET LOCAL hnsw.iterative_scan` block — it's specific to the old cosine HNSW with selective filters. The bit-Hamming index has different selectivity behavior; if filter post-rejection becomes an issue, we'll handle that as a follow-up.

Replace lines 91-97 with:

```python
    async with conn() as c:
        cur = await c.execute(sql, params)
        rows = await cur.fetchall()
```

- [ ] **Step 7: Run tests — expect pass**

```bash
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_semantic_search.py -v
```

Expected: all tests in the file pass.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/backend/tools/semantic_search.py apps/backend/tests/unit/test_semantic_search.py
git commit -m "feat(backend): two-stage rerank — bit-Hamming candidates + halfvec cosine"
```

---

### Task 10: Update `pipeline/embed.py` for halfvec + bit-quant indexing

**Files:**
- Modify: `packages/pipeline/pipeline/embed.py`

- [ ] **Step 1: Update INSERT statement to cast vector to halfvec**

Locate the INSERT in `db_writer` (around line 239-247). Change:

```python
                        """
                        INSERT INTO embeddings
                            (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical)
                        VALUES (%s, %s, %s, %s, %s, to_tsvector('russian', %s))
                        ON CONFLICT (work_slug, chapter_num, para_num, window_size) DO NOTHING
                        """,
```

to:

```python
                        """
                        INSERT INTO embeddings
                            (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical)
                        VALUES (%s, %s, %s, %s, %s::halfvec(1024), to_tsvector('russian', %s))
                        ON CONFLICT (work_slug, chapter_num, para_num, window_size) DO NOTHING
                        """,
```

- [ ] **Step 2: Update `_create_indexes` to build bit-quant HNSW**

Replace the entire function (currently lines 118-132):

```python
async def _create_indexes() -> None:
    async with conn() as c:
        print("[indexes] CREATE HNSW (bit-quantized)...", flush=True)
        await c.execute(
            "CREATE INDEX IF NOT EXISTS embeddings_vector_idx "
            "ON embeddings USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops) "
            "WITH (m=16, ef_construction=64)"
        )
        print("[indexes] CREATE GIN...", flush=True)
        await c.execute(
            "CREATE INDEX IF NOT EXISTS embeddings_lexical_idx "
            "ON embeddings USING gin (text_for_lexical)"
        )
        await c.execute("ANALYZE embeddings")
        print("[indexes] done", flush=True)
```

- [ ] **Step 3: Run pipeline tests to verify nothing else broke**

```bash
cd packages/pipeline
PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/ -v
```

Expected: all existing tests still pass (they're pure / offline, none touch DB or run embed.run).

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/pipeline/embed.py
git commit -m "feat(pipeline): embed inserts halfvec + builds bit-quant HNSW"
```

---

### Task 11: Apply migration `003` on prod

**Files:** none (DB state change)

- [ ] **Step 1: Verify pgvector version on prod is ≥ 0.7**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "SELECT extversion FROM pg_extension WHERE extname=\"vector\";"
'
```

Expected: `0.7.0` or higher. If older, abort and update pgvector first (out of scope for this plan — flag to user).

- [ ] **Step 2: Copy migration file to VPS**

```bash
scp -i ~/.ssh/yojimbo_deploy infra/migrations/003_halfvec_bitquant.sql ^
  root@31.130.148.190:/tmp/003_halfvec_bitquant.sql
```

- [ ] **Step 3: Apply migration**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker cp /tmp/003_halfvec_bitquant.sql infra-postgres-1:/tmp/003.sql
echo "[migration] applying 003 — vector → halfvec + bit-quant HNSW..."
time docker exec infra-postgres-1 psql -U postgres -d patristic -v ON_ERROR_STOP=1 -f /tmp/003.sql
echo "[migration] done"
'
```

Expected: ALTER TYPE finishes in 10-20 min, CREATE INDEX in 15-30 min. Combined wall time 30-60 min. Watch for errors.

- [ ] **Step 4: Verify post-state**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT format_type(atttypid, atttypmod) FROM pg_attribute
WHERE attrelid = '\''embeddings'\''::regclass AND attname='\''vector'\'';
"
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT indexdef FROM pg_indexes WHERE indexname=\"embeddings_vector_idx\";
"
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT pg_size_pretty(pg_database_size('\''patristic'\''));
"
'
```

Expected output:
- column type: `halfvec(1024)`
- index def includes `binary_quantize(vector)::bit(1024) bit_hamming_ops`
- DB size: ~10-12 GB (down from 26 GB)

- [ ] **Step 5: Record migration timing here**

ALTER duration: `____ min`. CREATE INDEX duration: `____ min`. Final DB size: `____`.

---

### Task 12: Deploy backend with updated `semantic_search.py`

**Files:** none (code is already committed; this triggers GitHub Actions build)

- [ ] **Step 1: Push the migration + backend code commits to master**

```bash
git push origin master
```

- [ ] **Step 2: Wait for GHCR build**

```bash
gh run list --limit 3 --workflow=build-and-push.yml
# Wait until the latest run shows "success"
gh run watch
```

- [ ] **Step 3: Pull and restart backend on prod**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
cd /opt/logospatrum && git pull --ff-only
cd infra
docker compose --env-file ../.env -f docker-compose.prod.yml pull backend
docker compose --env-file ../.env -f docker-compose.prod.yml up -d backend
docker image prune -f
'
```

- [ ] **Step 4: Smoke the backend from inside the docker network**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-nginx-1 wget -qO- http://backend:8000/info
'
```

Expected: JSON with `flags`, `version`. (External `https://logospatrum.com/api/info` returns 403 by design — anti-abuse firewall.)

---

### Task 13: Post-migration bench

**Files:**
- Output: `bench/after-migration.json`, `bench/diff-phase1.md`

- [ ] **Step 1: Re-run bench with the new label**

```bash
set POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic
set BUDGET_GUARD_ENABLED=false
PYTHONUTF8=1 apps/backend/.venv/Scripts/python scripts/bench_retrieval.py ^
  --label after-migration ^
  --output bench/after-migration.json
```

- [ ] **Step 2: Generate the diff markdown**

```bash
PYTHONUTF8=1 apps/backend/.venv/Scripts/python scripts/bench_diff.py ^
  bench/baseline.json bench/after-migration.json ^
  --output bench/diff-phase1.md
```

- [ ] **Step 3: Inspect `bench/diff-phase1.md` against acceptance targets**

Open the file. Verify:
- `addressed` pass-rate Δ ≥ −0.03
- `thematic` pass-rate Δ ≥ −0.05
- `cross` pass-rate Δ ≥ −0.05
- `semantic_p95` ≤ 1.5 × baseline
- Mean semantic top-10 Jaccard ≥ 0.85

If any fails: this is a STOP — do not proceed to Phase 2 without user discussion. Possible rollback via `pg_restore` from Task 6's dump.

- [ ] **Step 4: Commit results**

```bash
git add bench/after-migration.json bench/diff-phase1.md
git commit -m "bench(phase1): post-halfvec+bit-quant retrieval metrics"
```

⏸ **PHASE 1 STOP** — user reviews `bench/diff-phase1.md` and decides go/no-go on Phase 2.

---

## Phase 2 — Scrape canonized corpus

### Task 14: Build `canonized` author diff against prod

**Files:**
- Create: `scripts/canonized_diff.py`
- Create: `scripts/tests/test_canonized_diff.py`

- [ ] **Step 1: Write test for the parser**

```python
"""Tests for the canonized author list parser (no live HTTP)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from canonized_diff import parse_authors


CANONIZED_HTML_FIXTURE = """
<html><body>
<div class="authors-list">
  <a href="/otechnik/Ioann_Lestvichnik" class="author-name">Иоанн Лествичник, преподобный</a>
  <a href="/otechnik/Lopuhin" class="author-name">Александр Лопухин</a>
  <a href="/otechnik/Some_Saint" class="author-name">Some Saint</a>
</div>
</body></html>
"""


def test_parse_authors_extracts_url_and_name():
    authors = parse_authors(CANONIZED_HTML_FIXTURE, base_url="https://azbyka.ru")
    assert len(authors) == 3
    assert {"url": "https://azbyka.ru/otechnik/Ioann_Lestvichnik", "name": "Иоанн Лествичник, преподобный"} in authors
```

- [ ] **Step 2: Run test, expect failure**

```bash
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -m pytest scripts/tests/test_canonized_diff.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement the script**

```python
"""Fetch canonized author list from azbyka.ru and compute diff against prod authors.

NOTE: the exact azbyka.ru DOM for the canonized filter is not documented here —
the script first fetches one URL and dumps the HTML; the parser is then adjusted
against actual markup. Treat the selector `.authors-list a.author-name` below as
a STARTING POINT that may need to be tightened based on real HTML.

Usage:
    set POSTGRES_DSN=postgresql://postgres:<pw>@host:port/patristic
    PYTHONUTF8=1 .venv/Scripts/python scripts/canonized_diff.py \
        --output canonized_diff.json \
        --base-url https://azbyka.ru \
        --filter-url https://azbyka.ru/otechnik/?authorsFilterBy=canonized&authorsSortBy=authors_by_last_name
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "apps" / "backend" / "src"))


def parse_authors(html: str, base_url: str = "https://azbyka.ru") -> list[dict]:
    """Extract author URLs + display names from a canonized-filter page.

    Returns list of {"url": absolute_url, "name": display_name}.
    """
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    # IMPORTANT: tighten this selector after inspecting real azbyka HTML.
    for a in soup.select("a.author-name, .authors-list a, .otechnik-list a"):
        href = a.get("href", "")
        name = a.get_text(strip=True)
        if not href or not name:
            continue
        if "/otechnik/" not in href:
            continue
        out.append({"url": urljoin(base_url, href), "name": name})
    # Dedup
    seen: set[str] = set()
    deduped: list[dict] = []
    for a in out:
        if a["url"] in seen:
            continue
        seen.add(a["url"])
        deduped.append(a)
    return deduped


def fetch_canonized(filter_url: str) -> list[dict]:
    """Walk pagination on the canonized filter URL, return all authors."""
    all_authors: list[dict] = []
    page = 1
    with httpx.Client(timeout=30, follow_redirects=True,
                      headers={"User-Agent": "logospatrum-pipeline/1.0"}) as c:
        while True:
            url = filter_url + (f"&page={page}" if page > 1 else "")
            r = c.get(url)
            r.raise_for_status()
            authors = parse_authors(r.text)
            if not authors:
                break
            new_urls = {a["url"] for a in authors} - {a["url"] for a in all_authors}
            if not new_urls:
                break
            all_authors.extend([a for a in authors if a["url"] in new_urls])
            print(f"[fetch] page {page}: +{len(new_urls)} new (total {len(all_authors)})")
            page += 1
            if page > 50:  # safety cap
                print("[fetch] hit page cap (50), stopping")
                break
    return all_authors


def slugify_url(url: str) -> str:
    """Extract the slug portion (last URL segment) for comparison.
    e.g. https://azbyka.ru/otechnik/Ioann_Lestvichnik → ioann_lestvichnik (lowercased,
    matching the existing slugify() convention in pipeline)."""
    segment = url.rstrip("/").rsplit("/", 1)[-1]
    # Mirror pipeline.slugify: transliterate Cyrillic, lowercase, _-separated.
    # For diff purposes a fuzzy lowercase + non-alnum→_ is enough.
    return re.sub(r"[^a-zA-Z0-9_]+", "_", segment).lower().strip("_")


async def fetch_prod_author_slugs(dsn: str) -> set[str]:
    import psycopg
    async with await psycopg.AsyncConnection.connect(dsn, connect_timeout=10) as c:
        cur = await c.execute("SELECT slug FROM authors")
        rows = await cur.fetchall()
    return {r[0] for r in rows}


def main() -> int:
    import asyncio

    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    p.add_argument("--base-url", default="https://azbyka.ru")
    p.add_argument("--filter-url", required=True)
    p.add_argument("--whitelist-extra",
                   nargs="*",
                   default=["https://azbyka.ru/otechnik/Lopuhin"],
                   help="Author URLs always included even if absent from canonized filter.")
    args = p.parse_args()

    dsn = os.environ.get("POSTGRES_DSN")
    if not dsn:
        print("ERROR: set POSTGRES_DSN", file=sys.stderr)
        return 1

    print(f"[canonized] fetching from {args.filter_url}")
    canonized = fetch_canonized(args.filter_url)
    for extra in args.whitelist_extra:
        if not any(a["url"] == extra for a in canonized):
            canonized.append({"url": extra, "name": "(whitelisted)"})

    prod_slugs = asyncio.run(fetch_prod_author_slugs(dsn))
    print(f"[canonized] {len(canonized)} canonized authors, {len(prod_slugs)} in prod")

    diff: list[dict] = []
    for a in canonized:
        candidate_slug = slugify_url(a["url"])
        # Soft match: candidate prefix of any prod slug, or substring match
        present = any(candidate_slug == s or candidate_slug in s or s.startswith(candidate_slug)
                      for s in prod_slugs)
        if not present:
            diff.append(a)

    Path(args.output).write_text(json.dumps(diff, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[canonized] {len(diff)} authors not in prod, wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run unit test**

```bash
PYTHONUTF8=1 apps/backend/.venv/Scripts/python -m pytest scripts/tests/test_canonized_diff.py -v
```

Expected: 1 test passes.

- [ ] **Step 5: Run live fetch against prod DB**

```bash
set POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic
PYTHONUTF8=1 apps/backend/.venv/Scripts/python scripts/canonized_diff.py ^
  --output canonized_diff.json ^
  --filter-url "https://azbyka.ru/otechnik/?authorsFilterBy=canonized&authorsSortBy=authors_by_last_name"
```

- [ ] **Step 6: Inspect canonized_diff.json**

Verify:
- The first few entries look like real author URLs (`https://azbyka.ru/otechnik/...`)
- File contains expected new authors (e.g., several names that you know are in `canonized` but not in current featured corpus)
- If the parser returned 0 or absurdly few authors, the CSS selector in `parse_authors` is wrong — inspect the HTML manually (`curl -A "..." <url> | head -200`) and tighten the selector before proceeding.

- [ ] **Step 7: Commit the script (NOT the diff JSON — that's data, gitignore it)**

```bash
echo canonized_diff.json >> .gitignore
git add scripts/canonized_diff.py scripts/tests/test_canonized_diff.py .gitignore
git commit -m "feat(pipeline): canonized author diff script"
```

---

### Task 15: Add `ingest-azbyka` typer subcommand

**Files:**
- Create: `packages/pipeline/pipeline/ingest_azbyka.py`
- Modify: `packages/pipeline/pipeline/__main__.py`

- [ ] **Step 1: Create the orchestrator module**

`packages/pipeline/pipeline/ingest_azbyka.py`:

```python
"""Orchestrate Scraper → Downloader → MarkdownConverter for a list of authors.

Bridges three previously-uncalled classes into a single typer-invocable command.
"""
from __future__ import annotations

import json
from pathlib import Path

from .config import Config
from .download import Downloader
from .markdown_convert import MarkdownConverter
from .scrape import Scraper


def run(authors_file: str, skip_existing: bool = True) -> None:
    """Process a JSON list of {"url": ..., "name": ...} entries.

    For each author:
      1. Scraper.scrape_author(url) → AuthorMetadata + list[WorkMetadata]
      2. Downloader.download_works(works) → epub files on disk
      3. MarkdownConverter.convert_author(author_dir) → md files on disk

    `skip_existing` means: if `output/<author>/<work>/<chapter>.md` already exists,
    don't re-download or re-convert.
    """
    config = Config.from_env()
    authors = json.loads(Path(authors_file).read_text(encoding="utf-8"))
    print(f"[ingest-azbyka] {len(authors)} authors to process")

    with Scraper(config) as scraper:
        downloader = Downloader(config)
        converter = MarkdownConverter(config)
        for i, a in enumerate(authors, 1):
            url = a["url"]
            print(f"[{i:>3}/{len(authors)}] {a.get('name','?')} — {url}")
            # The actual method names below depend on the existing class API.
            # Verify by reading scrape.py / download.py / markdown_convert.py
            # before running — the comment names may not match exactly.
            try:
                author_meta, works = scraper.scrape_author_page(url)  # check actual name
                if skip_existing:
                    works = [w for w in works if not converter.is_already_converted(author_meta, w)]
                if not works:
                    print(f"  [skip] all works already converted")
                    continue
                downloader.download_works(author_meta, works)
                converter.convert_author(author_meta, works)
            except Exception as e:
                print(f"  [error] {e!r} — skipping author")
                continue
```

**Caveat for the implementer:** Method names like `scrape_author_page`, `download_works`, `convert_author`, `is_already_converted` are placeholders. Before running this command, read `scrape.py`, `download.py`, `markdown_convert.py` and adjust the calls to match the **actual** public methods of those classes. The existing `Scraper.scrape_library_page` works on library URLs (list of authors), not on a single-author page — so a new method or a small loop adaptation is likely needed. If the methods don't exist, add them to those files; do NOT silently fail.

- [ ] **Step 2: Register the typer subcommand**

In `packages/pipeline/pipeline/__main__.py`, add after the `pravo` command (around line 37):

```python
@app.command(name="ingest-azbyka")
def ingest_azbyka(
    authors_file: str,
    skip_existing: bool = True,
) -> None:
    """Scrape → download → markdown-convert for a JSON list of author URLs.

    Input file format: [{"url": "https://azbyka.ru/otechnik/...", "name": "..."}, ...]
    Resumable: per-work skip if md files already exist on disk.
    """
    from .ingest_azbyka import run as _run
    _run(authors_file=authors_file, skip_existing=skip_existing)
```

- [ ] **Step 3: Smoke-test the typer wiring**

```bash
cd packages/pipeline
PYTHONUTF8=1 .venv/Scripts/python -m pipeline --help
```

Expected: `ingest-azbyka` appears in the command list.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/pipeline/ingest_azbyka.py packages/pipeline/pipeline/__main__.py
git commit -m "feat(pipeline): ingest-azbyka subcommand wiring Scraper→Downloader→Converter"
```

---

### Task 16: Run scrape for canonized diff

**Files:** none (creates files under `packages/pipeline/output/`)

- [ ] **Step 1: Sanity-check disk space for downloads**

```powershell
Get-PSDrive C
```

Expected: ≥ 30 GB free (markdown is small but EPUBs accumulate; pipeline does not auto-delete EPUBs).

- [ ] **Step 2: Run ingest-azbyka against the diff**

```bash
cd packages/pipeline
PYTHONUTF8=1 .venv/Scripts/python -m pipeline ingest-azbyka ^
  --authors-file ../../canonized_diff.json ^
  --skip-existing
```

Expected runtime: hours (depends on number of new authors; throttle on azbyka.ru limits to ~1 req/s). Watch for HTTP 429 — increase throttle if seen.

- [ ] **Step 3: Spot-check output**

```bash
ls packages/pipeline/output/ | wc -l
# Inspect 3 random new author dirs:
ls packages/pipeline/output/ | shuf -n 3 | xargs -I{} ls "packages/pipeline/output/{}"
```

Open 2-3 random `.md` files and confirm:
- Frontmatter has `author`, `book_title`, `chapter_title`, `chapter_number`, `section`, `source_url`
- Body contains real Russian patristic text, not error pages

- [ ] **Step 4: Record numbers below**

New author dirs added: `____`. New md files added: `____`.

⏸ **PHASE 2 STOP** — user reviews scraped markdown sample before proceeding to DB ingest.

---

## Phase 3 — Load to prod

### Task 17: Run `pipeline paragraphs` against prod DSN

**Files:** none (writes to prod DB)

- [ ] **Step 1: Pre-flight snapshot**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec infra-postgres-1 pg_dump -U postgres -d patristic -Fc \
  > /opt/logospatrum/backups/patristic-pre-corpus-${TS}.dump
echo "WROTE: /opt/logospatrum/backups/patristic-pre-corpus-${TS}.dump"
'
```

- [ ] **Step 2: Set pipeline DSN to prod**

Edit `packages/pipeline/.env` (the pipeline-local .env, NOT the repo root .env):

```bash
# Comment out the local DSN, add prod
# POSTGRES_DSN=postgresql://postgres:postgres@localhost:5432/patristic
POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic
```

- [ ] **Step 3: Run `paragraphs`**

```bash
cd packages/pipeline
PYTHONUTF8=1 .venv/Scripts/python -m pipeline paragraphs
```

Expected: progress per author; for already-present works, UPSERT/DELETE-then-INSERT is idempotent but expensive. Watch for FK errors (would indicate something missing in the scraped output).

- [ ] **Step 4: Verify row counts on prod**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT
  (SELECT count(*) FROM authors) AS authors,
  (SELECT count(*) FROM works) AS works,
  (SELECT count(*) FROM chapters) AS chapters,
  (SELECT count(*) FROM paragraphs) AS paragraphs;
"
'
```

Expected: authors ≥ ~400-500, works ≥ ~10000 (depending on scrape result), paragraphs ≥ 3-5M.

---

### Task 18: Drop bit-quant HNSW on prod for bulk embed insert

**Files:** none

- [ ] **Step 1: Drop the index**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "DROP INDEX IF EXISTS embeddings_vector_idx;"
'
```

Note: `pipeline embed` already calls `_drop_indexes()` at startup which drops both vector and lexical indexes — but doing it pre-emptively here protects against the case where embed is run with `--from-scratch` (which truncates first, then drops indexes, which would unnecessarily lock the table for the truncate).

- [ ] **Step 2: Confirm the drop**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT indexname FROM pg_indexes WHERE tablename='\''embeddings'\'';
"
'
```

Expected: `embeddings_pkey`, `embeddings_filter_idx`, and **NO** `embeddings_vector_idx`.

---

### Task 19: Run `pipeline embed` against prod with throttle (light mode)

**Files:** none (writes embeddings to prod)

- [ ] **Step 1: Verify CUDA is available locally**

```bash
cd packages/pipeline
PYTHONUTF8=1 .venv/Scripts/python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no gpu')"
```

Expected: `True <gpu name>`.

- [ ] **Step 2: Estimate work remaining**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT
  (SELECT count(*) FROM paragraphs) AS paragraphs,
  (SELECT count(*) FROM embeddings) AS existing_embeddings;
"
'
```

Estimate remaining windows: `(paragraphs × ~2.7) − existing_embeddings`. At ~135 win/sec light-mode rate, ETA `remaining / 135 / 3600` hours.

- [ ] **Step 3: Run embed in light-mode**

```bash
cd packages/pipeline
PYTHONUTF8=1 .venv/Scripts/python -m pipeline embed ^
  --throttle-ms 150 --cpu-threads 4
```

Tune `--throttle-ms` live:
- Higher (250) = even lighter load on GPU, longer wall time
- Lower (50) = full throttle, but display may stutter

Resume is automatic on Ctrl-C → restart.

- [ ] **Step 4: Monitor progress**

The script prints `[HH:MM:SS] embedded X/Y (rate win/sec, ETA min)` every ~5000 windows.

- [ ] **Step 5: Verify final count**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT count(*) FROM embeddings;
"
'
```

Expected: close to `paragraphs × 2.7` (each paragraph generates 1 window for ws=1, +1 for ws=2 if there's a next paragraph in the chapter, +1 for ws=3 if there's a chapter with 3+ paragraphs).

---

### Task 20: Recreate bit-quant HNSW on full extended embeddings table

**Files:** none

- [ ] **Step 1: Build the index**

The embed command auto-calls `_create_indexes()` at the end — but if it failed mid-build (e.g., disk pressure), you can re-run manually:

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
echo "[index] CREATE HNSW (bit-quant) on full corpus..."
time docker exec infra-postgres-1 psql -U postgres -d patristic -v ON_ERROR_STOP=1 -c "
CREATE INDEX IF NOT EXISTS embeddings_vector_idx
  ON embeddings
  USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops)
  WITH (m=16, ef_construction=64);
CREATE INDEX IF NOT EXISTS embeddings_lexical_idx
  ON embeddings USING gin (text_for_lexical);
ANALYZE embeddings;
"
'
```

Expected wall time: 30 min – 2 hours depending on final row count.

- [ ] **Step 2: Verify index sizes**

```bash
ssh -i ~/.ssh/yojimbo_deploy root@31.130.148.190 '
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE relname='\''embeddings'\'';
"
docker exec infra-postgres-1 psql -U postgres -d patristic -c "
SELECT pg_size_pretty(pg_database_size('\''patristic'\''));
"
'
```

Expected: `embeddings_vector_idx` ~3-5 GB at ×3 scale (was 1.5 GB at ×1). Total DB ~30-50 GB.

---

### Task 21: Spot-check via dev backend pointed at prod

**Files:** none (read-only verification)

- [ ] **Step 1: Run a one-off backend smoke**

Temporarily point the local backend `.env` at prod (in the repo root `.env`, NOT pipeline `.env`):

```
POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic
BUDGET_GUARD_ENABLED=false
```

Start the local backend:

```bash
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

- [ ] **Step 2: Hit /catalog and verify new authors**

```bash
curl http://localhost:8000/catalog | jq ". | length"
```

Expected: matches the new authors count from Task 17.

- [ ] **Step 3: Run a search via a newly-added author**

Pick an author from `canonized_diff.json` that you know was added. Curl semantic search:

```bash
# Replace <author_slug> with one of the new slugs
curl "http://localhost:8000/runs/stream" -X POST -H "Content-Type: application/json" \
  -d '{"input":{"messages":[{"role":"user","content":"что говорит <Имя> о покаянии"}]},"stream_mode":"updates"}'
```

Expected: SSE stream that includes a `read_passage` tool call with a citation slug starting with the new author. (Crude — full smoke requires the agent to actually quote; just verify retrieval surface.)

- [ ] **Step 4: Revert local .env**

Important: change `POSTGRES_DSN` back to the local docker DSN, OR keep `BUDGET_GUARD_ENABLED=false` if you're going to keep poking prod. Otherwise dev sessions count against prod's monthly budget cap.

---

### Task 22: Post-corpus bench

**Files:**
- Output: `bench/after-corpus.json`, `bench/diff-phase3.md`

- [ ] **Step 1: Run bench with post-corpus label**

```bash
set POSTGRES_DSN=postgresql://postgres:<PG_PASSWORD>@31.130.148.190:55432/patristic
set BUDGET_GUARD_ENABLED=false
PYTHONUTF8=1 apps/backend/.venv/Scripts/python scripts/bench_retrieval.py ^
  --label after-corpus ^
  --output bench/after-corpus.json
```

- [ ] **Step 2: Diff against post-migration baseline**

```bash
PYTHONUTF8=1 apps/backend/.venv/Scripts/python scripts/bench_diff.py ^
  bench/after-migration.json bench/after-corpus.json ^
  --output bench/diff-phase3.md
```

- [ ] **Step 3: Inspect**

Verify:
- Per-category pass-rates stay within ±0.05 of post-migration (corpus expansion may legitimately move recall in either direction)
- `semantic_p95` did not regress > 2× (HNSW search on 3× larger graph adds some latency)

- [ ] **Step 4: Commit**

```bash
git add bench/after-corpus.json bench/diff-phase3.md
git commit -m "bench(phase3): post-canonized-expansion retrieval metrics"
```

- [ ] **Step 5: Restore pipeline `.env` to local DSN**

Edit `packages/pipeline/.env` and uncomment the local DSN (or remove the prod override). Keep secrets out of git.

⏸ **PHASE 3 STOP** — user reviews final metrics and decides on follow-ups (enrich, additional corpus filters, etc.).

---

## Self-review

**Spec coverage check:**
- ✓ Phase 0 backup → Task 1
- ✓ Phase 0 audit → Task 2
- ✓ Phase 0 bench script → Tasks 3, 4
- ✓ Phase 0 baseline run → Task 5
- ✓ Phase 1 migration SQL → Task 7
- ✓ Phase 1 fresh-init patch → Task 8
- ✓ Phase 1 backend SQL update → Task 9
- ✓ Phase 1 pipeline INSERT + index update → Task 10
- ✓ Phase 1 apply migration → Task 11
- ✓ Phase 1 deploy backend → Task 12
- ✓ Phase 1 bench → Task 13
- ✓ Phase 2 author diff → Task 14
- ✓ Phase 2 ingest-azbyka wiring → Task 15
- ✓ Phase 2 scrape → Task 16
- ✓ Phase 3 paragraphs → Task 17
- ✓ Phase 3 index drop → Task 18
- ✓ Phase 3 embed → Task 19
- ✓ Phase 3 index rebuild → Task 20
- ✓ Phase 3 spot-check → Task 21
- ✓ Phase 3 bench → Task 22

**Open items the implementer must resolve at runtime:**
- The CSS selector in `scripts/canonized_diff.py:parse_authors` needs verification against real azbyka HTML (flagged in Task 14 Step 6).
- The exact public-method names of `Scraper`, `Downloader`, `MarkdownConverter` need verification before running Task 16 (flagged in Task 15 Step 1 caveat). These classes exist but were never wired into the typer CLI; their method signatures may differ from what the placeholder `ingest_azbyka.py` calls.
- The `low_conf_threshold` for the `empty_or_low_confidence` proxy starts at 0.45 (cosine distance) and should be calibrated from the Phase 0 baseline JSON before Phase 1 bench comparison.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-27-halfvec-bitquant-canonized-expansion.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
