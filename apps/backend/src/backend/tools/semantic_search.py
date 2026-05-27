"""Tool: semantic_search — bge-m3 + pgvector ANN with optional filters."""
from langchain_core.tools import tool

from ..db import conn
from ..embeddings import get_service
from ._citation import make_citation
from ._filters import resolve_section, slug_filter_sql


async def _get_service():
    # Indirection layer used by tests (monkeypatched to inject a FakeModel
    # without going through the real SentenceTransformer load).
    return await get_service()


@tool
async def semantic_search(
    query: str,
    author_slug: str | list[str] | None = None,
    work_slug: str | list[str] | None = None,
    section: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Семантический поиск через эмбеддинги (bge-m3 + pgvector HNSW).

    Args:
        query: текст запроса.
        author_slug: один slug или список slug'ов — ищет у указанного(ых) автора(ов).
            Передавай list[str], если хочешь искать у нескольких авторов сразу:
            **один эмбеддинг запроса** + один SQL-проход. Это драматически дешевле,
            чем N отдельных вызовов с одним автором.
        work_slug: один slug или список slug'ов — фильтр по труду(ам).
        section: фильтр по корпусу: "bible" / "scripture" → только Писание;
            "patristic" / "fathers" → только патристика. Алиасы кириллические тоже
            работают ("писание", "патристика"). Точное значение global_section
            тоже принимается.
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    if not query.strip():
        return []

    svc = await _get_service()
    await svc.start()
    vec = await svc.embed(query)

    filters: list[str] = []
    where_params: list = []

    a_sql, a_params = slug_filter_sql("w.author_slug", author_slug)
    if a_sql:
        filters.append(a_sql)
        where_params.extend(a_params)

    w_sql, w_params = slug_filter_sql("e.work_slug", work_slug)
    if w_sql:
        filters.append(w_sql)
        where_params.extend(w_params)

    if section:
        filters.append("a.global_section = %s")
        where_params.append(resolve_section(section))

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

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

    # When a selective WHERE filter is combined with HNSW ORDER BY, the default
    # ef_search=40 yields top-40 globally and then the filter rejects most/all
    # of them — empty results on author/section/work-filtered searches.
    # pgvector 0.8 `iterative_scan = strict_order` keeps re-entering the index
    # until LIMIT rows survive the filter, with exact distance order preserved.
    # ef_search is also bumped so the per-iteration candidate pool is bigger.
    # Applies to the bit-Hamming HNSW just like it did to the old cosine HNSW.
    async with conn() as c:
        async with c.transaction():
            if filters:
                await c.execute("SET LOCAL hnsw.iterative_scan = strict_order")
                await c.execute("SET LOCAL hnsw.ef_search = 100")
            cur = await c.execute(sql, params)
            rows = await cur.fetchall()

    return [
        {
            "citation": make_citation(r[0], r[1], r[2], r[3], r[4]),
            "work_slug": r[1],
            "chapter_num": r[2],
            "para_num": r[3],
            "window_size": r[4],
            "snippet": r[5],
            "score": float(r[6]),
        }
        for r in rows
    ]
