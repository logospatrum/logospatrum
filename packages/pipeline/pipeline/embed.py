"""Embed paragraph windows with bge-m3 + tsvector.

Producer -> 1 encoder -> N parallel DB writers via async queue.
Resumable by default; --from-scratch wipes embeddings table.

Performance defaults (validated by `profile_embed.py` on RTX 5070 Ti):
- fp16 weights:           ~2x encode speedup, no retrieval-quality regression.
- max_seq_length=512:     ~5-10% of windows get tail-truncated; encode time
                          on long batches drops dramatically.
- length-sorted buffer:   1024-window buffer is sorted by text length before
                          batching, eliminating padding waste.
Result: ~270 win/sec in async pipeline (was 46 win/sec on baseline).

To reduce desktop lag while embedding:
- `--throttle-ms 100` introduces asyncio.sleep between encode batches,
  letting the Windows display driver share the GPU.
- `--cpu-threads 4` caps PyTorch/OMP/MKL/tokenizer threads.
"""
import asyncio
import os
import time
from collections.abc import AsyncIterator

import torch
from sentence_transformers import SentenceTransformer

from .config import settings
from .db import init_pool, close_pool, conn
from .lexical_preprocess import preprocess


WINDOW_SIZES = (1, 2, 3)
DEFAULT_DB_WORKERS = 2          # was 4; DB is no longer the bottleneck.
DEFAULT_QUEUE_SIZE = 8
DEFAULT_SORT_BUFFER = 1024      # encoder buffers this many windows, sorts by
                                # length, then emits as fixed-size batches.


def _build_windows_for_chapter(paras: list[tuple[int, str]]) -> list[tuple[int, int, str]]:
    """[(para_num, text), ...] -> [(start_para_num, window_size, joined_text), ...]."""
    out: list[tuple[int, int, str]] = []
    paras = sorted(paras, key=lambda x: x[0])
    n = len(paras)
    for w in WINDOW_SIZES:
        for i in range(n - w + 1):
            chunk = paras[i:i + w]
            text = "\n\n".join(t for _, t in chunk)
            out.append((chunk[0][0], w, text))
    return out


# Backwards-compatible alias for the previous public helper name.
_build_windows = _build_windows_for_chapter


async def _load_done_keys() -> set[tuple]:
    """Return set of (work_slug, chapter_num, para_num, window_size) already embedded."""
    out: set[tuple] = set()
    async with conn() as c:
        cur = await c.execute(
            "SELECT work_slug, chapter_num, para_num, window_size FROM embeddings"
        )
        async for row in cur:
            out.add((row[0], row[1], row[2], row[3]))
    return out


async def _stream_windows(done_keys: set[tuple]) -> AsyncIterator[tuple]:
    """Yield (work_slug, chapter_num, start_para, window_size, text) for each missing window."""
    async with conn() as c:
        cur = await c.execute(
            "SELECT work_slug, chapter_num, para_num, text FROM paragraphs "
            "ORDER BY work_slug, chapter_num, para_num"
        )
        current_key = None
        bucket: list[tuple[int, str]] = []
        async for row in cur:
            key = (row[0], row[1])
            if current_key is not None and key != current_key:
                ws_chap = current_key
                for start, w, text in _build_windows_for_chapter(bucket):
                    k = (ws_chap[0], ws_chap[1], start, w)
                    if k not in done_keys:
                        yield (ws_chap[0], ws_chap[1], start, w, text)
                bucket = []
            current_key = key
            bucket.append((row[2], row[3]))
        if current_key is not None:
            for start, w, text in _build_windows_for_chapter(bucket):
                k = (current_key[0], current_key[1], start, w)
                if k not in done_keys:
                    yield (current_key[0], current_key[1], start, w, text)


async def _count_remaining(done_keys: set[tuple]) -> int:
    """Estimate total windows minus done. Cheap -- uses paragraph count per chapter."""
    async with conn() as c:
        cur = await c.execute(
            """
            SELECT work_slug, chapter_num, COUNT(*) AS n
            FROM paragraphs GROUP BY work_slug, chapter_num
            """
        )
        total = 0
        async for row in cur:
            n = row[2]
            # windows: 1-size = n, 2-size = max(0, n-1), 3-size = max(0, n-2)
            total += n + max(0, n - 1) + max(0, n - 2)
    return total - len(done_keys)


async def _drop_indexes() -> None:
    async with conn() as c:
        await c.execute("DROP INDEX IF EXISTS embeddings_vector_idx")
        await c.execute("DROP INDEX IF EXISTS embeddings_lexical_idx")


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


async def run(
    device: str | None = None,
    batch_size: int | None = None,
    from_scratch: bool = False,
    db_workers: int = DEFAULT_DB_WORKERS,
    queue_size: int = DEFAULT_QUEUE_SIZE,
    throttle_ms: int = 0,
    cpu_threads: int | None = None,
    sort_buffer: int = DEFAULT_SORT_BUFFER,
    max_seq_length: int = 512,
    fp16: bool = True,
) -> None:
    device = device or settings.embedding_device
    batch_size = batch_size or settings.embedding_batch_size

    if cpu_threads is not None:
        torch.set_num_threads(cpu_threads)
        os.environ["OMP_NUM_THREADS"] = str(cpu_threads)
        os.environ["MKL_NUM_THREADS"] = str(cpu_threads)
        os.environ["TOKENIZERS_PARALLELISM"] = "false"
        print(f"[start] CPU thread cap: {cpu_threads}", flush=True)

    await init_pool()

    if from_scratch:
        print("[start] --from-scratch: TRUNCATE embeddings", flush=True)
        async with conn() as c:
            await c.execute("TRUNCATE embeddings")
        done_keys: set[tuple] = set()
    else:
        print("[start] resume mode: loading done keys...", flush=True)
        done_keys = await _load_done_keys()
        print(f"[start] already embedded: {len(done_keys):,}", flush=True)

    print("[indexes] dropping for fast insert...", flush=True)
    await _drop_indexes()

    remaining = await _count_remaining(done_keys)
    print(f"[start] remaining to embed: {remaining:,}", flush=True)
    if remaining <= 0:
        print("[start] nothing to do, building indexes only.", flush=True)
        await _create_indexes()
        await close_pool()
        return

    print(f"[model] loading {settings.embedding_model} on {device} "
          f"(fp16={fp16}, max_seq={max_seq_length})...", flush=True)
    model_kwargs = {"torch_dtype": torch.float16} if (fp16 and device == "cuda") else None
    model = SentenceTransformer(
        settings.embedding_model, device=device, model_kwargs=model_kwargs,
    )
    model.max_seq_length = max_seq_length
    print(f"[model] loaded (dtype={next(model.parameters()).dtype}).", flush=True)

    encoded_q: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
    counter = {"n": 0, "last_report": 0}
    started = time.time()

    throttle_sec = throttle_ms / 1000.0 if throttle_ms > 0 else 0

    async def _flush_buffer(buffer: list[tuple]) -> None:
        """Sort by text length, emit fixed-size batches through the encoder."""
        if not buffer:
            return
        buffer.sort(key=lambda w: len(w[4]))
        for i in range(0, len(buffer), batch_size):
            batch = buffer[i:i + batch_size]
            texts = [w[4] for w in batch]
            vectors = await asyncio.to_thread(
                model.encode, texts,
                normalize_embeddings=True, show_progress_bar=False,
            )
            await encoded_q.put((batch, vectors))
            if throttle_sec:
                await asyncio.sleep(throttle_sec)

    async def encoder() -> None:
        buffer: list[tuple] = []
        async for win in _stream_windows(done_keys):
            buffer.append(win)
            if len(buffer) >= sort_buffer:
                await _flush_buffer(buffer)
                buffer = []
        await _flush_buffer(buffer)
        for _ in range(db_workers):
            await encoded_q.put(None)

    async def db_writer(wid: int) -> None:
        # autocommit=False + explicit commit per batch:
        # ONE fsync per batch (not per row), order-of-magnitude faster than
        # set_autocommit(True) which makes executemany do one transaction PER ROW.
        pool = await init_pool()
        async with pool.connection() as c:
            await c.set_autocommit(False)
            while True:
                item = await encoded_q.get()
                if item is None:
                    return
                batch, vectors = item
                rows = [
                    (b[0], b[1], b[2], b[3], vectors[i].tolist(), preprocess(b[4]))
                    for i, b in enumerate(batch)
                ]
                async with c.cursor() as cur:
                    await cur.executemany(
                        """
                        INSERT INTO embeddings
                            (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical)
                        VALUES (%s, %s, %s, %s, %s::halfvec(1024), to_tsvector('russian', %s))
                        ON CONFLICT (work_slug, chapter_num, para_num, window_size) DO NOTHING
                        """,
                        rows,
                    )
                await c.commit()
                counter["n"] += len(batch)
                # report every ~5000 windows
                if counter["n"] - counter["last_report"] >= 5000:
                    counter["last_report"] = counter["n"]
                    elapsed = time.time() - started
                    rate = counter["n"] / elapsed if elapsed > 0 else 0
                    eta_sec = (remaining - counter["n"]) / rate if rate > 0 else 0
                    print(
                        f"[{time.strftime('%H:%M:%S')}] embedded {counter['n']:,}/{remaining:,} "
                        f"({rate:.1f} win/sec, ETA {eta_sec/60:.1f} min)",
                        flush=True,
                    )

    enc_task = asyncio.create_task(encoder())
    db_tasks = [asyncio.create_task(db_writer(i)) for i in range(db_workers)]
    await enc_task
    await asyncio.gather(*db_tasks)

    elapsed = time.time() - started
    rate = counter["n"] / elapsed if elapsed > 0 else 0
    print(
        f"[done] embedded {counter['n']:,} windows in {elapsed/60:.1f} min "
        f"({rate:.1f} win/sec)",
        flush=True,
    )

    await _create_indexes()
    await close_pool()
