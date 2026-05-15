"""Per-stage profiler for the embed pipeline.

Synchronous (no asyncio), single-thread, single DB connection — meant to
isolate where time goes inside one batch: encode (GPU) vs preprocess (CPU)
vs vector.tolist (CPU) vs DB insert vs DB commit (fsync).

Env var OPTIMIZE controls which optimizations are applied:
  a = sort windows by text length before batching (kill padding waste)
  b = fp16 weights (model_kwargs torch_dtype=float16)
  c = truncate max_seq_length to 512 tokens (default bge-m3 is 8192)

Examples:
  OPTIMIZE=     -> baseline (no optimisations)
  OPTIMIZE=a    -> only length-sort
  OPTIMIZE=abc  -> all three

Usage:
    cd packages/pipeline
    PYTHONUTF8=1 .venv/Scripts/python profile_embed.py
"""
from __future__ import annotations

import os
import statistics
import time

import psycopg
import torch
from sentence_transformers import SentenceTransformer

from pipeline.config import settings
from pipeline.embed import _build_windows_for_chapter
from pipeline.lexical_preprocess import preprocess


N_CHAPTERS = 6      # chapters to pull (must have enough paragraphs)
BATCH_SIZE = 64
PROFILE_DB = "patristic_profile"  # isolated DB so we never touch the real corpus
OPTIMIZE = os.environ.get("OPTIMIZE", "").lower()
OPT_SORT = "a" in OPTIMIZE
OPT_FP16 = "b" in OPTIMIZE
OPT_TRUNC = "c" in OPTIMIZE


def setup_profile_db(real_dsn: str) -> str:
    """Create patristic_profile DB if missing, apply schema, return its DSN."""
    base = real_dsn.rsplit("/", 1)[0]
    admin_dsn = base + "/postgres"
    profile_dsn = base + "/" + PROFILE_DB

    with psycopg.connect(admin_dsn, autocommit=True, connect_timeout=10) as conn:
        cur = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname=%s", (PROFILE_DB,)
        )
        exists = cur.fetchone() is not None
        if not exists:
            conn.execute(f"CREATE DATABASE {PROFILE_DB}")
            print(f"[setup] created database {PROFILE_DB}", flush=True)

    # Apply schema (idempotent due to IF NOT EXISTS in migration)
    schema_path = settings.data_dir.parent.parent.parent / "infra" / "migrations" / "001_init.sql"
    with open(schema_path, encoding="utf-8") as f:
        schema_sql = f.read()
    with psycopg.connect(profile_dsn, autocommit=True, connect_timeout=10) as conn:
        conn.execute(schema_sql)
    return profile_dsn


def fetch_sample_chapters(real_dsn: str, n: int) -> list[tuple[str, int, list[tuple[int, str]]]]:
    """Pick `n` chapters with >=25 paragraphs from the real corpus (read-only)."""
    out: list[tuple[str, int, list[tuple[int, str]]]] = []
    with psycopg.connect(real_dsn, connect_timeout=10) as c:
        cur = c.execute(
            """
            SELECT work_slug, chapter_num
            FROM paragraphs
            GROUP BY work_slug, chapter_num
            HAVING COUNT(*) >= 25
            ORDER BY MD5(work_slug || chapter_num::text)
            LIMIT %s
            """,
            (n,),
        )
        keys = cur.fetchall()
        for ws, cn in keys:
            cur2 = c.execute(
                "SELECT para_num, text FROM paragraphs "
                "WHERE work_slug=%s AND chapter_num=%s ORDER BY para_num",
                (ws, cn),
            )
            paras = [(r[0], r[1]) for r in cur2.fetchall()]
            out.append((ws, cn, paras))
    return out


def seed_profile_db(profile_dsn: str, chapters: list[tuple[str, int, list[tuple[int, str]]]]) -> None:
    """Insert just enough authors/works/chapters/paragraphs so embed INSERT's FK passes."""
    with psycopg.connect(profile_dsn, connect_timeout=10) as c:
        c.execute("TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE")
        c.execute(
            "INSERT INTO authors(slug, name_display) VALUES ('_profile', 'Profile') "
            "ON CONFLICT DO NOTHING"
        )
        seen_works = set()
        seen_chaps = set()
        for ws, cn, paras in chapters:
            if ws not in seen_works:
                c.execute(
                    "INSERT INTO works(slug, author_slug, title_display, paragraph_count) "
                    "VALUES (%s, '_profile', %s, %s)",
                    (ws, ws, len(paras)),
                )
                seen_works.add(ws)
            if (ws, cn) not in seen_chaps:
                c.execute(
                    "INSERT INTO chapters(work_slug, chapter_num) VALUES (%s, %s)",
                    (ws, cn),
                )
                seen_chaps.add((ws, cn))
            with c.cursor() as cur:
                cur.executemany(
                    "INSERT INTO paragraphs(work_slug, chapter_num, para_num, text) "
                    "VALUES (%s, %s, %s, %s)",
                    [(ws, cn, p, t) for p, t in paras],
                )
        c.commit()


def main() -> None:
    real_dsn = settings.postgres_dsn
    print(f"[profile] real_dsn={real_dsn}", flush=True)

    profile_dsn = setup_profile_db(real_dsn)
    print(f"[profile] profile_dsn={profile_dsn}", flush=True)

    print(f"[profile] fetching {N_CHAPTERS} chapters from real DB...", flush=True)
    chapters = fetch_sample_chapters(real_dsn, N_CHAPTERS)
    if not chapters:
        print("[profile] no chapters with >=25 paras in real DB. Run `pipeline paragraphs` first.")
        return
    n_paras = sum(len(p) for _, _, p in chapters)
    print(f"[profile] got {len(chapters)} chapters, {n_paras} paragraphs total", flush=True)

    print("[profile] seeding profile DB...", flush=True)
    seed_profile_db(profile_dsn, chapters)

    # Build windows (CPU only)
    t0 = time.perf_counter()
    all_windows: list[tuple[str, int, int, int, str]] = []
    for ws, cn, paras in chapters:
        for start, w, text in _build_windows_for_chapter(paras):
            all_windows.append((ws, cn, start, w, text))
    t_build = (time.perf_counter() - t0) * 1000
    print(f"[profile] built {len(all_windows)} windows in {t_build:.1f}ms (CPU)", flush=True)
    print(f"[profile] optimizations: sort={OPT_SORT} fp16={OPT_FP16} trunc512={OPT_TRUNC}", flush=True)
    if OPT_SORT:
        all_windows.sort(key=lambda w: len(w[4]))
        print("[profile] windows sorted by text length", flush=True)

    # Stats on text length
    lens = [len(w[4]) for w in all_windows]
    print(f"[profile] text len: mean={statistics.mean(lens):.0f}  "
          f"med={statistics.median(lens):.0f}  "
          f"min={min(lens)}  max={max(lens)}", flush=True)

    # Load model
    device = settings.embedding_device
    print(f"[profile] loading {settings.embedding_model} on {device}...", flush=True)
    t0 = time.perf_counter()
    model_kwargs = {"torch_dtype": torch.float16} if OPT_FP16 else None
    model = SentenceTransformer(
        settings.embedding_model, device=device, model_kwargs=model_kwargs,
    )
    if OPT_TRUNC:
        model.max_seq_length = 512
        print(f"[profile] max_seq_length set to {model.max_seq_length}", flush=True)
    print(f"[profile] model loaded in {time.perf_counter() - t0:.1f}s "
          f"(dtype={next(model.parameters()).dtype})", flush=True)

    # Warmup
    if all_windows:
        _ = model.encode(
            [w[4] for w in all_windows[:8]],
            normalize_embeddings=True, show_progress_bar=False,
        )
        print("[profile] warmup done (encoded 8)", flush=True)

    batches = [all_windows[i:i + BATCH_SIZE] for i in range(0, len(all_windows), BATCH_SIZE)]
    print(f"[profile] {len(batches)} batches of {BATCH_SIZE}", flush=True)

    sql = """
        INSERT INTO embeddings
            (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical)
        VALUES (%s, %s, %s, %s, %s, to_tsvector('russian', %s))
        ON CONFLICT (work_slug, chapter_num, para_num, window_size) DO NOTHING
    """

    timings = {
        "encode_ms": [],
        "preprocess_ms": [],
        "tolist_ms": [],
        "db_insert_ms": [],
        "db_commit_ms": [],
        "total_ms": [],
    }

    with psycopg.connect(profile_dsn, autocommit=False, connect_timeout=10) as conn:
        for i, batch in enumerate(batches):
            t_total_start = time.perf_counter()

            texts = [w[4] for w in batch]

            t0 = time.perf_counter()
            vectors = model.encode(
                texts, normalize_embeddings=True, show_progress_bar=False,
            )
            t_encode = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            preprocessed = [preprocess(t) for t in texts]
            t_preprocess = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            vec_lists = [vectors[j].tolist() for j in range(len(batch))]
            t_tolist = (time.perf_counter() - t0) * 1000

            rows = [
                (b[0], b[1], b[2], b[3], vec_lists[j], preprocessed[j])
                for j, b in enumerate(batch)
            ]
            t0 = time.perf_counter()
            with conn.cursor() as cur:
                cur.executemany(sql, rows)
            t_insert = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            conn.commit()
            t_commit = (time.perf_counter() - t0) * 1000

            t_total = (time.perf_counter() - t_total_start) * 1000

            timings["encode_ms"].append(t_encode)
            timings["preprocess_ms"].append(t_preprocess)
            timings["tolist_ms"].append(t_tolist)
            timings["db_insert_ms"].append(t_insert)
            timings["db_commit_ms"].append(t_commit)
            timings["total_ms"].append(t_total)

            print(
                f"[batch {i+1:2d}/{len(batches)}] enc={t_encode:6.1f}  "
                f"prep={t_preprocess:5.1f}  tolist={t_tolist:5.1f}  "
                f"ins={t_insert:6.1f}  com={t_commit:6.1f}  tot={t_total:6.1f} ms",
                flush=True,
            )

    print("\n=== Per-stage timing (excluding first batch as warm-up) ===", flush=True)
    print(f"Windows: {sum(len(b) for b in batches)}, batches: {len(batches)}, "
          f"batch_size: {BATCH_SIZE}", flush=True)

    skip_first = 1 if len(batches) > 1 else 0
    for stage in ["encode_ms", "preprocess_ms", "tolist_ms",
                  "db_insert_ms", "db_commit_ms", "total_ms"]:
        vals = timings[stage][skip_first:]
        if not vals:
            continue
        mean = statistics.mean(vals)
        med = statistics.median(vals)
        print(f"  {stage:15s} mean={mean:7.1f}  med={med:7.1f}  "
              f"min={min(vals):7.1f}  max={max(vals):7.1f}", flush=True)

    totals = timings["total_ms"][skip_first:]
    if totals:
        mean_batch_s = statistics.mean(totals) / 1000
        win_per_sec = BATCH_SIZE / mean_batch_s
        # Share of total per stage
        sum_other = sum(statistics.mean(timings[s][skip_first:])
                        for s in ["encode_ms", "preprocess_ms", "tolist_ms",
                                  "db_insert_ms", "db_commit_ms"])
        print(f"\nSingle-thread throughput: {win_per_sec:.1f} win/sec "
              f"({mean_batch_s*1000:.0f}ms/batch)", flush=True)
        print("Share of mean batch total:", flush=True)
        for stage in ["encode_ms", "preprocess_ms", "tolist_ms",
                      "db_insert_ms", "db_commit_ms"]:
            m = statistics.mean(timings[stage][skip_first:])
            print(f"  {stage:15s} {m / sum_other * 100:5.1f}%", flush=True)
        print(f"  (unaccounted: {(statistics.mean(totals) - sum_other) / statistics.mean(totals) * 100:.1f}% — async/loop overhead, GC, etc.)",
              flush=True)


if __name__ == "__main__":
    main()
