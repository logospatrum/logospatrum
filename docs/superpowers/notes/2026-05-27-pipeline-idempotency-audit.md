# Pipeline idempotency audit — 2026-05-27

Prep work for the halfvec + canonized expansion plan. Verifies what each pipeline step does when re-run on a partial corpus, so we can rely on resume semantics during Phase 3 (direct write to prod).

## Summary table

| Stage | CLI? | Skip-existing? | Re-run cost on full corpus | Notes |
|---|---|---|---|---|
| `Scraper` | ❌ (class only, no typer cmd) | n/a (writes JSON metadata; no built-in skip) | small | Saves `<work>.json` under `data/<section>/<author>/`; no internal skip check. Safe to re-run because it overwrites idempotent data. |
| `Downloader` | ❌ | ✅ skips if `epub_path` already set in JSON, or `epub_path.exists()` | seconds | `download_epub` exits early when target epub file exists. `run()` also checks `work.epub_path` set previously. |
| `MarkdownConverter` | ❌ | ⚠️ no explicit skip — always rewrites md | minutes | `save_markdown` always overwrites. If we re-run on a partially-converted corpus, every chapter md gets rewritten. Idempotent (same content), but wasteful. |
| `paragraphs` | ✅ | partial — UPSERT for authors/works/chapters; DELETE-then-INSERT per chapter for paragraphs | 8-10 min full corpus | Always replaces paragraph rows even for unchanged chapters. No work_slug-level skip. **For Phase 3 we want to add `--skip-existing-works` to short-circuit chapters whose work is already in DB.** |
| `bible-markdown` | ✅ | ✅ skip-if-exists per book dir | seconds (when up to date) | Already idempotent. |
| `embed` | ✅ | ✅ resumable via `_load_done_keys` (loads all PK tuples) | matches remaining work | `from_scratch` truncates table; default mode skips already-embedded windows. Drops + recreates HNSW + GIN at boundaries. |
| `concepts-bootstrap` | ✅ | ✅ skip if term already in `glossary.json` | 0 (out of scope) | Not run in this plan. |
| `enrich` | ✅ | n/a (out of scope) | 0 (out of scope) | Not run in this plan. |

## Per-module details

### `scrape.py` — class `Scraper`

- **Reads:** `libraries_file` URLs (default `data/libraries.txt`).
- **Writes:** `data/<section>/<author>/<work>.json` per work.
- **Skip logic:** none in the class itself; relies on file-overwrite semantics.
- **Re-run behavior:** scrapes everything fresh, overwrites JSON. Cheap (~1 HTTP/work).
- **Phase 2 implication:** the new `ingest-azbyka` subcommand (Task 15) should filter the **author list** to only new authors before calling Scraper, since Scraper itself has no per-author skip.

### `download.py` — class `Downloader`

- **Reads:** every `*.json` under `data/`.
- **Writes:** `data/<section>/<author>/epubs/<work_stem>.epub`.
- **Skip logic (line 43-44):**
  ```python
  if epub_path.exists():
      return str(epub_path.relative_to(self.config.data_dir.parent))
  ```
  Also `run()` checks `if work.epub_path: continue`.
- **Re-run behavior:** safe and fast. Re-runs only download missing epubs.

### `markdown_convert.py` — class `MarkdownConverter`

- **Reads:** non-Bible JSON metadata (line 23-30 explicitly skips `data/Bible/`).
- **Writes:** `output/<section>/<author>/<work>/<NNN>_<chapter>.md`.
- **Skip logic:** **none**. `save_markdown` always writes (no `path.exists()` check).
- **Re-run behavior:** re-converts every epub on every run. Wasteful but idempotent (output content stable for a given input). For Phase 2, the `ingest-azbyka` orchestrator should filter to just-scraped new authors to avoid touching all 92 existing.

### `paragraphs.py` — typer cmd `paragraphs`

- **Reads:** all `*.md` under `output_dir`, splits patristic vs Bible by path (`Bible/` is special).
- **Writes:** rows into `authors`, `works`, `chapters`, `paragraphs`.
- **Skip logic per row type:**
  - `_upsert_author`: `ON CONFLICT (slug) DO UPDATE` — always touches author row, harmless.
  - `_upsert_work`: same, harmless.
  - `_upsert_chapter`: same, harmless.
  - `_replace_paragraphs`: **DELETE-then-INSERT** for the chapter's paragraphs every time (line 169-198). No idempotency check at the chapter level.
- **Re-run behavior:** processes every md file, deletes + re-inserts paragraphs for every chapter even if unchanged. Wall time ~8-10 min for full corpus; full table scan to delete + insert.
- **Phase 3 implication:** for the ×3 corpus, re-running paragraphs for the existing 730K rows + new ~2M = ~30 min of churn for existing data. **Mitigation:** add a pre-filter that skips md files whose `work_slug` already has paragraph rows AND `chapters.source_md_path` matches. Cheaper alternative: filter md files at the filesystem level to only the new author dirs (output_dir override).
- **Note:** if Phase 2 left only new author dirs under output (because we ran ingest-azbyka on the diff), then `pipeline paragraphs` already processes only those, with no extra filter needed. **This is the recommended path** — keep filesystem clean per phase.

### `embed.py` — typer cmd `embed`

- **Reads:** `paragraphs` table.
- **Writes:** `embeddings` table.
- **Skip logic (line 56, `_load_done_keys`):** loads every existing PK tuple `(work_slug, chapter_num, para_num, window_size)` into a Python `set`. The window-stream filter checks each candidate against this set.
- **Re-run behavior:**
  - Default: resume. Skips already-embedded windows. Re-builds indexes at end.
  - `--from-scratch`: TRUNCATEs the embeddings table first. Don't use during Phase 3.
- **Index handling:**
  - `_drop_indexes` (line 112-115) drops `embeddings_vector_idx` AND `embeddings_lexical_idx` at startup.
  - `_create_indexes` (line 118-132) rebuilds both at end of run, then `ANALYZE`.
  - **Will be updated in Task 10** to build bit-quant HNSW instead of cosine HNSW.
- **Memory:** `_load_done_keys` set is ~250 MB for current 2M rows. At ×3 corpus ~750 MB — still fine.
- **Phase 3 implication:** safe to run multiple times; restart on Ctrl-C resumes from where it left off. Light-mode (`--throttle-ms 150 --cpu-threads 4`) lets the host machine stay usable.

## Recommendations for Phase 2/3 execution

1. **Phase 2 strategy:** the `ingest-azbyka` orchestrator (Task 15) takes a JSON list of NEW authors only (the canonized_diff output from Task 14). It internally calls Scraper → Downloader → MarkdownConverter for each. This keeps the output directory growing strictly with the diff.
2. **Phase 3 paragraphs:** **don't add a CLI flag** for skip-existing-works. Instead rely on the natural filesystem cleanliness from step 1 — `pipeline paragraphs` only sees new author dirs.
3. **Phase 3 embed:** drop the bit-quant HNSW manually before starting embed (Task 18) to skip embed's own `_drop_indexes` for the already-non-existent vector index. Then run embed; it builds bit-quant HNSW at the end as part of `_create_indexes`.

## Open issues found during audit

- **`MarkdownConverter` has no skip-if-exists check** — for Phase 2 we mitigate by filtering at the orchestrator level (only iterate new authors), but the class itself is wasteful on full re-runs. Not in scope to fix now.
- **`_chapter_num_from_filename` regex assumes `NNN_` prefix** (`re.match(r"^(\d+)_", filename)`). If azbyka starts using different naming we'd silently get chapter=1 for every md. Not a current issue.
- **`_century_from_years` accepts any 3-4 digit substring** (`re.search(r"\d{3,4}", years)`). If "years_of_life" contains a stray year reference, the century may be wrong. Cosmetic, not blocking.

No idempotency-breaking bugs found. The plan's Phase 3 ordering (paragraphs → drop HNSW → embed → recreate HNSW) is safe.
