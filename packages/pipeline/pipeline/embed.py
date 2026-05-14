"""Embed paragraph windows with bge-m3 + tsvector index."""
from rich.progress import Progress
from sentence_transformers import SentenceTransformer

from .config import settings
from .db import init_pool, close_pool, conn
from .lexical_preprocess import preprocess


WINDOW_SIZES = (1, 2, 3)


def _build_windows(paragraphs: list[tuple[int, str]]) -> list[tuple[int, int, str]]:
    """[(para_num, text)] → [(start_para_num, window_size, joined_text)]."""
    out: list[tuple[int, int, str]] = []
    paragraphs = sorted(paragraphs, key=lambda x: x[0])
    n = len(paragraphs)
    for w in WINDOW_SIZES:
        for i in range(n - w + 1):
            chunk = paragraphs[i:i + w]
            text = "\n\n".join(t for _, t in chunk)
            out.append((chunk[0][0], w, text))
    return out


async def _stream_chapters(c):
    cur = await c.execute(
        """
        SELECT work_slug, chapter_num, para_num, text
        FROM paragraphs
        ORDER BY work_slug, chapter_num, para_num
        """
    )
    current_key = None
    bucket: list[tuple[int, str]] = []
    async for row in cur:
        key = (row[0], row[1])
        if current_key is not None and key != current_key:
            yield current_key, bucket
            bucket = []
        current_key = key
        bucket.append((row[2], row[3]))
    if current_key is not None:
        yield current_key, bucket


async def run(device: str | None = None, batch_size: int | None = None) -> None:
    device = device or settings.embedding_device
    batch_size = batch_size or settings.embedding_batch_size

    print(f"Loading {settings.embedding_model} on {device}...")
    model = SentenceTransformer(settings.embedding_model, device=device)
    print("Model loaded.")

    await init_pool()
    async with conn() as c:
        await c.execute("TRUNCATE embeddings")

        windows: list[tuple[str, int, int, int, str]] = []
        async for (work_slug, chapter_num), paragraphs in _stream_chapters(c):
            for start_para, w, text in _build_windows(paragraphs):
                windows.append((work_slug, chapter_num, start_para, w, text))

        print(f"Will embed {len(windows)} windows.")

        with Progress() as progress:
            task = progress.add_task("Embedding", total=len(windows))
            for batch_start in range(0, len(windows), batch_size):
                batch = windows[batch_start:batch_start + batch_size]
                texts = [t[4] for t in batch]
                vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
                rows = [
                    (b[0], b[1], b[2], b[3], vectors[i].tolist(), preprocess(b[4]))
                    for i, b in enumerate(batch)
                ]
                async with c.cursor() as cur:
                    await cur.executemany(
                        """
                        INSERT INTO embeddings
                            (work_slug, chapter_num, para_num, window_size,
                             vector, text_for_lexical)
                        VALUES (%s, %s, %s, %s, %s, to_tsvector('russian', %s))
                        """,
                        rows,
                    )
                progress.update(task, advance=len(batch))

    print("Building HNSW and GIN indexes...")
    async with conn() as c:
        await c.execute(
            "CREATE INDEX IF NOT EXISTS embeddings_vector_idx "
            "ON embeddings USING hnsw (vector vector_cosine_ops) "
            "WITH (m=16, ef_construction=64)"
        )
        await c.execute(
            "CREATE INDEX IF NOT EXISTS embeddings_lexical_idx "
            "ON embeddings USING gin (text_for_lexical)"
        )
        await c.execute("ANALYZE embeddings")

    await close_pool()
    print("Done.")
