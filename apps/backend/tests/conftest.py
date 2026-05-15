"""Pytest fixtures shared across backend tests."""
import os

# Use a dedicated test database so test fixtures NEVER touch production data.
# The db_clean fixture TRUNCATEs everything; pointing this at the prod DB
# destroys the corpus on every test run. See `infra/migrations/001_init.sql`
# applied to patristic_test for schema setup.
DB_DSN_TEST = os.environ.get(
    "PATRISTIC_TEST_DSN",
    "postgresql://postgres:postgres@localhost:5432/patristic_test",
)
# MUST be set BEFORE `import backend` below, so backend.config.settings
# (pydantic-settings BaseSettings) reads patristic_test, not patristic.
# Otherwise tools (read_passage, lexical_search, …) hit the prod DB while
# fixtures seed the test DB, and assertions fail with empty results.
os.environ["POSTGRES_DSN"] = DB_DSN_TEST

import backend  # noqa: F401,E402 — sets WindowsSelectorEventLoopPolicy on Windows

from typing import Any  # noqa: E402
import pytest  # noqa: E402
import psycopg  # noqa: E402


class FakeModel:
    """Mock SentenceTransformer for tests. Returns deterministic vectors based on text."""
    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim
        self.encode_calls: list[list[str]] = []

    def encode(self, texts: list[str], **kwargs: Any):
        import numpy as np
        self.encode_calls.append(list(texts))
        out = np.zeros((len(texts), self.dim), dtype="float32")
        for i, t in enumerate(texts):
            out[i, 0] = float(len(t)) / 1000.0
            out[i, 1] = float(hash(t) % 1000) / 1000.0
        return out


@pytest.fixture
def fake_model() -> FakeModel:
    return FakeModel()


@pytest.fixture
async def db_clean():
    """Truncate all tables before+after test."""
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST, connect_timeout=10) as c:
        await c.execute("TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE")
    yield
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST, connect_timeout=10) as c:
        await c.execute("TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE")


@pytest.fixture
async def db_with_seed_authors(db_clean):
    """Seed 3 authors with works."""
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST, connect_timeout=10) as c:
        await c.execute("""
            INSERT INTO authors (slug, name_display, years, century, global_section) VALUES
            ('avgustin', 'Аврелий Августин, блаженный', '(354–430)', 5, 'Православная библиотека'),
            ('lestvichnik', 'Иоанн Лествичник, преподобный', '(~579–~649)', 7, 'Православная библиотека'),
            ('platon', 'Платон', '(427–347 до н.э.)', -4, 'Философия')
        """)
        await c.execute("""
            INSERT INTO works (slug, author_slug, title_display, creation_date, section, source_url, paragraph_count) VALUES
            ('avgustin_ispoved', 'avgustin', 'Исповедь', '400', 'Автобиографические сочинения',
             'https://azbyka.ru/otechnik/Avrelij_Avgustin/ispoved/', 412),
            ('lestvichnik_lestvica', 'lestvichnik', 'Лествица', '600', 'Аскетические сочинения',
             'https://azbyka.ru/otechnik/Ioann_Lestvichnik/lestvica/', 1247),
            ('platon_gosudarstvo', 'platon', 'Государство', '380 до н.э.', NULL,
             'https://azbyka.ru/otechnik/filosofija/platon/gosudarstvo/', 800)
        """)
    yield


@pytest.fixture
async def db_with_paragraphs(db_with_seed_authors):
    """Add chapters, paragraphs, and lexical-only embeddings (zero vectors)."""
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST, connect_timeout=10) as c:
        await c.execute("""
            INSERT INTO chapters (work_slug, chapter_num, title) VALUES
            ('lestvichnik_lestvica', 4, 'О блаженном послушании'),
            ('lestvichnik_lestvica', 1, 'Об отречении')
        """)
        await c.execute("""
            INSERT INTO paragraphs (work_slug, chapter_num, para_num, text, char_offset_start, char_offset_end) VALUES
            ('lestvichnik_lestvica', 4, 1, 'Послушание есть совершенное отречение от своей души.', 0, 60),
            ('lestvichnik_lestvica', 4, 2, 'Послушник тот, кто, имея тело по виду, ум же ангельский, не имеет вовсе своей воли.', 60, 150),
            ('lestvichnik_lestvica', 1, 1, 'Отречение от мира есть произвольная ненависть к похваляемому веществу.', 0, 80)
        """)
        await c.execute("""
            INSERT INTO embeddings (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical) VALUES
            ('lestvichnik_lestvica', 4, 1, 1, ARRAY_FILL(0::float4, ARRAY[1024])::vector,
             to_tsvector('russian', 'послушание есть совершенное отречение от своей души')),
            ('lestvichnik_lestvica', 4, 2, 1, ARRAY_FILL(0::float4, ARRAY[1024])::vector,
             to_tsvector('russian', 'послушник тот кто имея тело по виду ум же ангельский не имеет вовсе своей воли')),
            ('lestvichnik_lestvica', 1, 1, 1, ARRAY_FILL(0::float4, ARRAY[1024])::vector,
             to_tsvector('russian', 'отречение от мира есть произвольная ненависть к похваляемому веществу'))
        """)
    yield
