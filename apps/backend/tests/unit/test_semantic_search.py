import pytest
import psycopg

from backend.tools import semantic_search as ss_module
from backend.embeddings.service import EmbeddingService

# Re-use the test-DB DSN that conftest already exports — it points at
# patristic_test (NOT prod patristic). Hardcoding the prod DSN here would
# read seeds from conftest (which writes to patristic_test) but try to
# insert into prod, hitting FK errors.
from tests.conftest import DB_DSN_TEST


@pytest.fixture
async def db_with_real_vectors(db_with_seed_authors, fake_model):
    texts = [
        ("lestvichnik_lestvica", 4, 1, "Послушание есть совершенное отречение"),
        ("lestvichnik_lestvica", 4, 2, "Послушник имея тело по виду ум ангельский"),
        ("lestvichnik_lestvica", 1, 1, "Отречение от мира есть произвольная ненависть"),
    ]
    vectors = fake_model.encode([t[3] for t in texts])

    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST, connect_timeout=10) as c:
        await c.execute("INSERT INTO chapters (work_slug, chapter_num, title) VALUES "
                        "('lestvichnik_lestvica', 4, 'О послушании'), "
                        "('lestvichnik_lestvica', 1, 'Об отречении')")
        for t, v in zip(texts, vectors):
            await c.execute(
                "INSERT INTO paragraphs (work_slug, chapter_num, para_num, text, char_offset_start, char_offset_end) "
                "VALUES (%s,%s,%s,%s,0,%s)",
                [t[0], t[1], t[2], t[3], len(t[3])],
            )
            await c.execute(
                "INSERT INTO embeddings (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical) "
                "VALUES (%s,%s,%s,1,%s::halfvec(1024),to_tsvector('russian',%s))",
                [t[0], t[1], t[2], v.tolist(), t[3]],
            )
    yield


@pytest.mark.asyncio
async def test_semantic_search_returns_top_match(db_with_real_vectors, fake_model, monkeypatch):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    async def _stub():
        return svc
    monkeypatch.setattr(ss_module, "_get_service", _stub)
    try:
        result = await ss_module.semantic_search.ainvoke({"query": "Послушание есть совершенное отречение"})
        assert len(result) >= 1
        top = result[0]
        assert top["work_slug"] == "lestvichnik_lestvica"
        assert top["citation"].startswith("lestvichnik/lestvichnik_lestvica/")
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_semantic_search_filter_by_author(db_with_real_vectors, fake_model, monkeypatch):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    async def _stub():
        return svc
    monkeypatch.setattr(ss_module, "_get_service", _stub)
    try:
        result = await ss_module.semantic_search.ainvoke({"query": "Отречение", "author_slug": "lestvichnik"})
        for r in result:
            assert "lestvichnik" in r["citation"]
    finally:
        await svc.stop()


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
