"""Latency benchmark for backend tools.

Calls each tool directly (no LLM, no langgraph) against the real
patristic DB. Times N iterations per variant after a warmup, prints a
table of median/mean/min/max ms + result-payload size.

Run:
    cd apps/backend
    PYTHONUTF8=1 .venv/Scripts/python bench_tools.py
"""
from __future__ import annotations

import asyncio
import json
import statistics
import time
from typing import Any, Callable

from backend.db import init_pool, close_pool
from backend.tools.expand_concept import expand_concept
from backend.tools.lexical_search import lexical_search
from backend.tools.list_authors import list_authors
from backend.tools.list_works import list_works
from backend.tools.read_passage import read_passage
from backend.tools.semantic_search import semantic_search


ITERS_FAST = 8   # lex/list/concept/read — cheap
ITERS_SLOW = 4   # semantic — CPU embed, slow
WARMUP = 1


def fmt_bytes(n: int) -> str:
    return f"{n}b" if n < 1024 else f"{n/1024:.1f}KB"


async def time_one(label: str, fn: Callable, args: dict, iters: int) -> dict:
    times: list[float] = []
    last_result_size = 0
    # Warmup
    for _ in range(WARMUP):
        r = await fn.ainvoke(args)
        last_result_size = len(json.dumps(r, ensure_ascii=False, default=str))
    # Timed
    for _ in range(iters):
        t = time.perf_counter()
        r = await fn.ainvoke(args)
        times.append((time.perf_counter() - t) * 1000)
        last_result_size = len(json.dumps(r, ensure_ascii=False, default=str))
    return {
        "label": label,
        "n": iters,
        "median": statistics.median(times),
        "mean": statistics.mean(times),
        "min": min(times),
        "max": max(times),
        "payload": last_result_size,
    }


async def main() -> None:
    await init_pool()

    results: list[dict] = []
    print("[bench] running…", flush=True)

    # === expand_concept ===
    print("  expand_concept hit/miss…", flush=True)
    results.append(await time_one(
        "expand_concept(hit: 'гордость')", expand_concept, {"term": "гордость"}, ITERS_FAST,
    ))
    results.append(await time_one(
        "expand_concept(miss: 'Фаворский свет')", expand_concept, {"term": "Фаворский свет"}, ITERS_FAST,
    ))

    # === list_authors ===
    print("  list_authors variants…", flush=True)
    results.append(await time_one(
        "list_authors() [all 86, default limit=20]", list_authors, {}, ITERS_FAST,
    ))
    results.append(await time_one(
        "list_authors(q='палама')", list_authors, {"q": "палама"}, ITERS_FAST,
    ))
    results.append(await time_one(
        "list_authors(q='святитель') [many matches]", list_authors, {"q": "святитель"}, ITERS_FAST,
    ))

    # === list_works ===
    print("  list_works variants…", flush=True)
    results.append(await time_one(
        "list_works(zlatoust) [154 works, capped at limit=30]",
        list_works, {"author_slug": "ioann_zlatoust_svjatitel"}, ITERS_FAST,
    ))
    results.append(await time_one(
        "list_works(zlatoust, q='беседы') [~filtered]",
        list_works, {"author_slug": "ioann_zlatoust_svjatitel", "q": "беседы"}, ITERS_FAST,
    ))
    results.append(await time_one(
        "list_works(palama, no q) [small author]",
        list_works, {"author_slug": "grigorij_palama_svjatitel"}, ITERS_FAST,
    ))

    # === lexical_search ===
    print("  lexical_search variants…", flush=True)
    Q = "смирение"
    results.append(await time_one(
        f"lexical_search('{Q}') [no filter]",
        lexical_search, {"query": Q}, ITERS_FAST,
    ))
    results.append(await time_one(
        f"lexical_search('{Q}', author=Palama)",
        lexical_search, {"query": Q, "author_slug": "grigorij_palama_svjatitel"}, ITERS_FAST,
    ))
    results.append(await time_one(
        f"lexical_search('{Q}', author=[Z, Nis, Avg, Pal])",
        lexical_search, {"query": Q, "author_slug": [
            "ioann_zlatoust_svjatitel", "grigorij_nisskij_svjatitel",
            "avrelij_avgustin_blazhennyj", "grigorij_palama_svjatitel",
        ]}, ITERS_FAST,
    ))
    results.append(await time_one(
        f"lexical_search('{Q}', section='bible')",
        lexical_search, {"query": Q, "section": "bible"}, ITERS_FAST,
    ))
    results.append(await time_one(
        f"lexical_search('{Q}', section='patristic')",
        lexical_search, {"query": Q, "section": "patristic"}, ITERS_FAST,
    ))

    # === semantic_search ===
    print("  semantic_search variants (slower, CPU embed)…", flush=True)
    results.append(await time_one(
        f"semantic_search('{Q}') [no filter]",
        semantic_search, {"query": Q}, ITERS_SLOW,
    ))
    results.append(await time_one(
        f"semantic_search('{Q}', author=Palama)",
        semantic_search, {"query": Q, "author_slug": "grigorij_palama_svjatitel"}, ITERS_SLOW,
    ))
    results.append(await time_one(
        f"semantic_search('{Q}', author=[Z, Nis, Avg, Pal])",
        semantic_search, {"query": Q, "author_slug": [
            "ioann_zlatoust_svjatitel", "grigorij_nisskij_svjatitel",
            "avrelij_avgustin_blazhennyj", "grigorij_palama_svjatitel",
        ]}, ITERS_SLOW,
    ))
    results.append(await time_one(
        f"semantic_search('{Q}', section='bible')",
        semantic_search, {"query": Q, "section": "bible"}, ITERS_SLOW,
    ))
    results.append(await time_one(
        f"semantic_search('{Q}', section='patristic')",
        semantic_search, {"query": Q, "section": "patristic"}, ITERS_SLOW,
    ))

    # === read_passage ===
    print("  read_passage hit/miss…", flush=True)
    # Pick a real citation from the corpus
    real_citation = "grigorij_palama_svjatitel/grigorij_palama_svjatitel_omilii/0036/p1"
    results.append(await time_one(
        "read_passage(real, context=2)",
        read_passage, {"citation": real_citation, "context_n": 2}, ITERS_FAST,
    ))
    results.append(await time_one(
        "read_passage(real, context=0)",
        read_passage, {"citation": real_citation, "context_n": 0}, ITERS_FAST,
    ))
    results.append(await time_one(
        "read_passage(hallucinated)",
        read_passage, {"citation": "fake-author/fake-work/9999/p1", "context_n": 0}, ITERS_FAST,
    ))

    await close_pool()

    # Print table
    print()
    print(f"{'tool variant':70s}  {'med':>7s}  {'mean':>7s}  {'min':>7s}  {'max':>7s}  {'payload':>8s}")
    print("-" * 110)
    for r in results:
        print(f"{r['label']:70s}  "
              f"{r['median']:6.1f}ms  {r['mean']:6.1f}ms  "
              f"{r['min']:6.1f}ms  {r['max']:6.1f}ms  "
              f"{fmt_bytes(r['payload']):>8s}")


if __name__ == "__main__":
    asyncio.run(main())
