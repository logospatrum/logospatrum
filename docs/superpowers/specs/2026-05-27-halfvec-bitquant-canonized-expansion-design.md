# Halfvec + bit-quant migration & `canonized` corpus expansion — design

**Date:** 2026-05-27
**Scope:** Storage migration on prod DB (`vector(1024)` → `halfvec(1024)` + bit-quantized HNSW) and corpus expansion from `featured_bogoslov` (~2,127 works / 92 authors) to `canonized` filter on azbyka.ru (estimated ~10K works / ~500 authors).
**Status:** Approved by user, pending implementation plan.

## Motivation

Current prod DB is 26 GB at 2M embedding windows. Naive ×5-10 expansion (full `canonized` filter) projects to ~250 GB DB on a 96 GB VPS — does not fit. Two storage levers reduce this without quality loss:

1. **`halfvec(1024)`** (float16) — halves vector storage and HNSW index. Recall loss < 1%.
2. **Bit-quantized HNSW** + halfvec rerank — index shrinks ~8× (12 GB → ~1.5 GB on current 2M). Recall loss 1-3%, mitigated via two-stage retrieval (binary top-K, then exact cosine on halfvec).

Combined: 26 GB → ~11.5 GB on current corpus. At ×10 corpus this projects to ~115 GB, fitting on the current VPS after disk cleanup (55 GB free post-cleanup) — though tight; final fit depends on actual `canonized` size.

Corpus expansion uses azbyka.ru `?authorsFilterBy=canonized` (superset of current `featured_bogoslov`), plus explicit whitelist for Толковая Библия Лопухина and Каноническое право in case the filter excludes them.

## Real storage breakdown (measured 2026-05-27 on prod)

| Component | Size | % |
|---|---|---|
| HNSW vector index (`embeddings_vector_idx`) | **12 GB** | 46% |
| Vector data (TOAST) | **~8.2 GB** | 32% |
| `text_for_lexical` tsvector (TOAST) | ~2.8 GB | 11% |
| `paragraphs` (heap+TOAST) | 644 MB | 2.5% |
| GIN lexical index | 417 MB | 1.6% |
| `embeddings_pkey` | 206 MB | 0.8% |
| Other | < 200 MB | < 1% |
| **Total** | **~26 GB** | |

Per-row averages (1% sample): vector 4100 B, tsvector 1403 B, paragraph text 743 B. Window distribution: ws=1: 731K, ws=2: 657K, ws=3: 606K.

## Constraints (user-confirmed)

1. **No `patristic_test` in the plan.** Migration applied directly to prod. Safety net = `pg_dump` before each destructive step + ability to restore.
2. **Full downtime of vector search during index rebuild is OK** (blocking `CREATE INDEX`, not `CONCURRENTLY`). Lexical search remains available.
3. **Only one HNSW index after migration** — bit-quantized. No parallel halfvec HNSW. Reranking happens on top-K via sequential `halfvec <=> query` on candidates.
4. **Pipeline runs directly against prod DSN** for the new corpus ingest (POSTGRES_DSN points at `31.130.148.190:55432`). Local disk has insufficient space for staging.
5. **`text_for_lexical` is NOT dropped** in this migration (preserves window-level lexical matching; storage savings already sufficient via halfvec + bit-quant).
6. **`concepts-bootstrap` and `enrich` are skipped** for new works in this round. New works ship with text + embeddings only; topics remain empty until a separate enrichment pass.
7. **Goldset eval (LLM-based) is replaced** by a token-free retrieval-only bench script.

## Phase plan

### Phase 0 — Pre-flight

Outputs: backup file, retrieval bench script, baseline metrics, audit notes.

- **VPS disk cleanup** — already done (2026-05-27 evening): `docker image prune -f`, `docker builder prune -f`, `apt-get clean`, `journalctl --vacuum-time=3d`. Result: 12 GB freed, 55 GB free on `/`. *Note:* listed here for plan completeness; the implementation plan should skip this step or mark it done.
- **Pre-flight backup**: `pg_dump -Fc patristic > /opt/logospatrum/backups/patristic-pre-halfvec-<UTC>.dump` via `docker exec`. Expected size ~5-8 GB (custom format with compression).
- **Audit pipeline idempotency** (read-only code review, no execution):
  - `scrape.py` — already skips if md exists
  - `download.py` — skips if epub exists
  - `markdown_convert.py` — skips if md exists
  - `paragraphs.py` — uses UPSERT for `works/authors/chapters`, DELETE-then-INSERT per chapter for `paragraphs`. Idempotent but rewrites unchanged chapters. For new corpus add: skip files already in DB (`WHERE work_slug = ?`) via `--skip-existing-works` flag.
  - `embed.py` — resumable via `_load_done_keys` (in-memory set of `(work_slug, chapter_num, para_num, window_size)`). ✓
  - Document findings in `docs/superpowers/notes/2026-05-27-pipeline-idempotency-audit.md`.
- **Write `scripts/bench_retrieval.py`** (new artifact). Spec below.
- **Run bench on prod** → save `bench/baseline-<UTC>.json`.

⏸ **Stop** — review baseline metrics.

### Phase 1 — Migration

Outputs: migrated prod schema, updated code, new SQL migration file, post-migration bench.

- **Fresh `pg_dump`** to `backups/patristic-pre-migration-<UTC>.dump`.
- **SQL migration** (`infra/migrations/003_halfvec_bitquant.sql`):
  ```sql
  -- Step 1: Convert vector column type. pgvector supports halfvec since 0.7.
  ALTER TABLE embeddings
    ALTER COLUMN vector TYPE halfvec(1024)
    USING vector::halfvec(1024);

  -- Step 2: Drop old HNSW, create bit-quantized HNSW.
  DROP INDEX IF EXISTS embeddings_vector_idx;

  CREATE INDEX embeddings_vector_idx
    ON embeddings
    USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops)
    WITH (m = 16, ef_construction = 64);
  -- Note: m=16, ef=64 (defaults) instead of current m=8, ef=32 since bit-index
  -- is much smaller (~1.5 GB) and we can afford higher quality params.

  -- Step 3: Refresh planner stats.
  ANALYZE embeddings;
  ```
  Estimated time on 2M rows: ALTER ~10-20 min (rewrites all heap pages); CREATE INDEX ~15-30 min (HNSW build on binary representations is fast).
- **Update `infra/migrations/001_init.sql`** so fresh DBs reflect the new schema (`vector` → `halfvec`, no separate vector HNSW DDL since `embed.py:_create_indexes` builds the bit-quant index at end of run — see code change below).
- **Update backend code** (`apps/backend/src/backend/tools/semantic_search.py`):
  - Query SQL switches from single-stage `ORDER BY vector <=> $query` to two-stage:
    ```sql
    WITH cand AS (
      SELECT work_slug, chapter_num, para_num, window_size, vector
      FROM embeddings
      WHERE <filters>
      ORDER BY binary_quantize(vector)::bit(1024)
               <~> binary_quantize($query::halfvec(1024))::bit(1024)
      LIMIT 100
    )
    SELECT ... , vector <=> $query::halfvec(1024) AS dist
    FROM cand
    ORDER BY dist
    LIMIT $top_k;
    ```
  - Query embedding cast to `halfvec` before passing to SQL (numpy float32 → float16 in `embeddings/service.py` or at query boundary).
- **Update pipeline code** (`packages/pipeline/pipeline/embed.py`):
  - INSERT statement casts vector to halfvec: `... %s::halfvec(1024) ...`
  - `_create_indexes` builds bit-quantized HNSW (same DDL as migration `003`).
- **Run bench post-migration** → save `bench/after-migration-<UTC>.json`.
- **Compare** baseline vs post-migration in `bench/diff-phase1.md`. Targets:
  - `top_K_overlap@10 ≥ 0.85` (semantic search; 85% Jaccard with baseline)
  - `latency_p95` regression < 50% (semantic search p95)
  - Recall on `addressed` proxy ≥ baseline − 3 pp
  - Recall on `thematic`/`cross` proxy ≥ baseline − 5 pp

⏸ **Stop** — review bench diff. If regression exceeds targets, rollback via `pg_restore` from pre-migration dump.

### Phase 2 — Scrape new corpus (filesystem only)

Outputs: new markdown files on local disk under `output/`. No DB writes.

- **Build the canonized author list:**
  - Fetch `https://azbyka.ru/otechnik/?authorsFilterBy=canonized&authorsSortBy=authors_by_last_name` (paginated).
  - Parse author URLs and display names.
  - Compute diff: `canonized_authors \ existing_authors_in_prod_DB` (query prod via `SELECT slug FROM authors`).
  - Whitelist additions (always include if missing): Толковая Библия Лопухина author dir, plus the `canonized` set should already include canon-law fathers.
- **For each new author**: invoke `Scraper` → `Downloader` → `MarkdownConverter`. These currently live as importable classes; **add a single typer subcommand** that runs the trio for a given author URL list (NOT wired today per `packages/pipeline/CLAUDE.md`). New command: `pipeline ingest-azbyka --authors-file canonized_diff.json --skip-existing`.
- All output lands under `packages/pipeline/output/<Author>/<Work>/...md` per existing convention.

⏸ **Stop** — user reviews markdown sample to verify scrape correctness.

### Phase 3 — Load new corpus into prod

Outputs: extended prod DB with new authors/works/paragraphs/embeddings.

- **`pipeline paragraphs`** with `POSTGRES_DSN` pointed at prod (`postgresql://postgres:$PG_PASSWORD@31.130.148.190:55432/patristic`). UPSERT semantics mean existing rows are unaffected.
- **Drop bit-quant HNSW** on prod to speed up bulk insert: `DROP INDEX embeddings_vector_idx;`.
- **`pipeline embed`** (CUDA on dev machine, writes to prod) with light-mode throttle:
  ```
  pipeline embed --throttle-ms 150 --cpu-threads 4
  ```
  These flags exist today (see `embed.py` perf notes in pipeline CLAUDE.md). Effective rate ~135 win/sec with throttle, so 6M new windows ≈ ~12 hours. Tune throttle live based on UX.
- **Recreate bit-quant HNSW** on full extended embeddings table.
- **ANALYZE** embeddings + paragraphs.
- **Run bench** → `bench/after-corpus-<UTC>.json`.
- Spot-check via `list_authors` / `list_works` from a dev backend pointed at prod.

⏸ **Stop** — final smoke + decision on `enrich` pass.

## SQL artefacts

### `infra/migrations/003_halfvec_bitquant.sql`

```sql
BEGIN;
ALTER TABLE embeddings
  ALTER COLUMN vector TYPE halfvec(1024)
  USING vector::halfvec(1024);
DROP INDEX IF EXISTS embeddings_vector_idx;
CREATE INDEX embeddings_vector_idx
  ON embeddings
  USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops)
  WITH (m = 16, ef_construction = 64);
COMMIT;
ANALYZE embeddings;
```

### `infra/migrations/001_init.sql` patch

Replace `vector vector(1024)` with `vector halfvec(1024)` in the `embeddings` table definition. Vector HNSW DDL (currently absent from 001) remains the responsibility of `embed.py:_create_indexes` after first bulk insert.

## Code changes — exact file list

| File | Change |
|---|---|
| `apps/backend/src/backend/tools/semantic_search.py` | Two-stage rerank query; query embedding cast to halfvec. |
| `apps/backend/src/backend/embeddings/service.py` (or query boundary) | Output numpy → float16 → pgvector halfvec literal. |
| `apps/backend/tests/unit/test_semantic_search.py` | Adjust expected SQL / fixture values for halfvec. |
| `packages/pipeline/pipeline/embed.py` | INSERT casts vector → halfvec; `_create_indexes` builds bit-quant HNSW. |
| `packages/pipeline/pipeline/db.py` | (likely no change — DSN driven) |
| `packages/pipeline/pipeline/__main__.py` | New typer subcommand `ingest-azbyka` wiring `Scraper` → `Downloader` → `MarkdownConverter`. |
| `infra/migrations/001_init.sql` | `vector(1024)` → `halfvec(1024)` for fresh installs. |
| `infra/migrations/003_halfvec_bitquant.sql` | New migration file. |
| `scripts/bench_retrieval.py` | New token-free bench script. |
| `docs/superpowers/notes/2026-05-27-pipeline-idempotency-audit.md` | New audit doc. |

## Bench script (`scripts/bench_retrieval.py`)

Token-free retrieval bench. Runs `semantic_search` and `lexical_search` directly (no agent, no LLM).

**Behavior:**
1. Load `tests/eval/gold.yaml` via existing `backend.eval_runner.load_goldset`.
2. For each entry, call `semantic_search_tool(query, top_k=20)` and `lexical_search_tool(query, top_k=20)` via direct module import (not HTTP).
3. Record per-query: query, category, expected_authors / expected_citations, semantic_top20 (list of citation slugs), lexical_top20, semantic_latency_ms, lexical_latency_ms.
4. Compute per-category pass-rate using a simplified pass logic:
   - `at_least_one_match`: any `parse_citation(slug).author_slug ∈ expected_authors` in semantic OR lexical top-20.
   - `any_match`: any `(work_slug, chapter_num)` in expected_citations matches semantic OR lexical top-20.
   - `at_least_two_authors`: ≥2 distinct authors from expected appear in semantic top-20 (lexical OR'd in if helpful).
   - `empty_or_low_confidence`: proxy via `max_semantic_score < THRESHOLD` (threshold TBD during baseline run; initial guess 0.45 cosine distance, calibrate from baseline).
   - `adversarial_safe`: marked `covered_by_llm_only`, excluded from pass-rate.
5. Output JSON: `{run_id, ts, baseline_or_target, per_query: [...], summary: {by_category: {addressed: {pass_rate, n}, ...}, latency: {sem_p50, sem_p95, sem_p99, lex_p50, lex_p95, lex_p99}}}`.
6. CLI: `python scripts/bench_retrieval.py --label baseline --output bench/baseline-<ts>.json`.

**Diff tool**: `scripts/bench_diff.py baseline.json target.json` outputs per-query top-K Jaccard plus pass-rate deltas in markdown. Used between phases.

## Backup & rollback

- **All backups** live under `/opt/logospatrum/backups/` on VPS. Rotation: keep last 5 pre-migration dumps + last 3 post-migration dumps.
- **Phase 1 rollback** (within hours of migration): `pg_restore -d patristic --clean --if-exists patristic-pre-migration-<UTC>.dump`. Bit-quant index dropped, table reverted to `vector(1024)`. Backend SQL changes must be reverted simultaneously.
- **Phase 3 partial failures** (mid-embed): re-run `pipeline embed`; resume logic skips already-inserted rows. If wrong rows landed, target them via `DELETE FROM embeddings WHERE work_slug IN (...) AND <bad-condition>` then re-embed.
- **Post-Phase-3 catastrophic rollback**: restore from `patristic-pre-corpus-<UTC>.dump` (snapshot taken at end of Phase 1). Loses Phase 3 ingest but recovers a known-good state.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `halfvec` cast loses too much precision on edge vectors | Low | Bench p1 catches it via `top_K_overlap@10`. Rollback if < 0.85. |
| Bit-quant HNSW returns poor candidates, rerank can't recover | Med | Top-K = 100 in stage 1 is generous (5× the final 20). If still bad, fallback to `m=24, ef_construction=128`. |
| `ALTER TYPE` on 2M rows locks table for hours | Med | Tested ALTER duration on prod via `EXPLAIN` first. If > 30 min, accept downtime (already user-approved per constraint #2). |
| Pipeline writes to prod corrupt data | Med | ON CONFLICT DO NOTHING on paragraphs/embeddings. Manual smoke (e.g. spot-check 10 random new citations via `read_passage` from dev backend) before extending. |
| New corpus contains malformed HTML that breaks `markdown_convert` | Med | Phase 2 has explicit stop for user review. Scraper has retry/skip pattern from `scrape.py`. |
| Bench `empty_or_low_confidence` threshold is wrong | Low | Acceptable to have noisy proxy for negative category in first pass; tune in follow-up. |
| Prod DSN credentials leak via shell history | Low | Use `.env` file in pipeline venv (already gitignored), never pass `PG_PASSWORD` as CLI arg. |
| Anti-abuse `__global_month` cap triggers during bench/migration | Low | Bench bypasses agent → no LLM → no cost. Pipeline doesn't touch budget table. |

## Acceptance criteria

- **Phase 0**:
  - `pg_dump` file present, size 4-10 GB compressed.
  - `scripts/bench_retrieval.py` exists, runs against prod, produces JSON with all 53 entries scored (except adversarial flagged as covered_by_llm_only).
  - `bench/baseline-<UTC>.json` committed (or stored alongside backups).
- **Phase 1**:
  - `SELECT pg_typeof(vector) FROM embeddings LIMIT 1` → `halfvec`.
  - `\d embeddings_vector_idx` shows `USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops)`.
  - `semantic_search_tool` returns non-empty top-K for 5 sample queries.
  - Bench post-migration JSON: `addressed_pass_rate ≥ baseline − 3 pp`, `thematic_pass_rate ≥ baseline − 5 pp`, `top_K_overlap@10 ≥ 0.85`, `semantic_latency_p95 ≤ 1.5 × baseline`.
  - DB total size reduced by ≥ 12 GB on the existing 2M rows.
- **Phase 2**:
  - `output/` contains at least one new author dir with valid markdown frontmatter (`author`, `book_title`, `chapter_title`, `chapter_number`, `section`, `source_url`).
  - Diff against prod authors shows ≥ 100 new author candidates.
- **Phase 3**:
  - `SELECT COUNT(*) FROM authors` increased to ≥ 4× baseline (target ~500 authors).
  - `SELECT COUNT(*) FROM embeddings` consistent with `paragraphs × avg(window_count)`.
  - HNSW index rebuilt and `embeddings_vector_idx` shows healthy `idx_scan` after smoke.
  - Bench post-corpus: pass-rates per category stay within ± 5 pp of post-migration baseline (corpus expansion may legitimately shift recall in either direction).
  - One sample query per category returns results from at least one newly-added author.

## Out of scope

- `concepts-bootstrap` re-run (seed list unchanged).
- `enrich` for new works (`works.topics` stays empty).
- Adversarial bench coverage (still requires LLM run; deferred).
- Author/work `slug → integer ID` refactor (separate large project, not justified by ×10 scale alone).
- Switching to a dedicated vector DB (Qdrant/Milvus). Not needed at projected ×10 size.
- `text_for_lexical` drop. Not needed for projected ×10 fit after cleanup; deferred until ×20+ becomes realistic.
