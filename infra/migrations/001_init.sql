-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authors
CREATE TABLE IF NOT EXISTS authors (
    slug TEXT PRIMARY KEY,
    name_display TEXT NOT NULL,
    years TEXT,
    century INTEGER,
    global_section TEXT
);

-- Works
CREATE TABLE IF NOT EXISTS works (
    slug TEXT PRIMARY KEY,
    author_slug TEXT NOT NULL REFERENCES authors(slug) ON DELETE CASCADE,
    title_display TEXT NOT NULL,
    creation_date TEXT,
    section TEXT,
    source_url TEXT,
    topics JSONB,
    paragraph_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS works_author_idx ON works(author_slug);

-- Chapters
CREATE TABLE IF NOT EXISTS chapters (
    work_slug TEXT NOT NULL REFERENCES works(slug) ON DELETE CASCADE,
    chapter_num INTEGER NOT NULL,
    title TEXT,
    source_md_path TEXT,
    PRIMARY KEY (work_slug, chapter_num)
);

-- Paragraphs
CREATE TABLE IF NOT EXISTS paragraphs (
    work_slug TEXT NOT NULL,
    chapter_num INTEGER NOT NULL,
    para_num INTEGER NOT NULL,
    text TEXT NOT NULL,
    char_offset_start INTEGER,
    char_offset_end INTEGER,
    PRIMARY KEY (work_slug, chapter_num, para_num),
    FOREIGN KEY (work_slug, chapter_num) REFERENCES chapters(work_slug, chapter_num) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS paragraphs_work_idx ON paragraphs(work_slug);

-- Embeddings (windows of 1-3 paragraphs)
CREATE TABLE IF NOT EXISTS embeddings (
    work_slug TEXT NOT NULL,
    chapter_num INTEGER NOT NULL,
    para_num INTEGER NOT NULL,           -- start paragraph of window
    window_size INTEGER NOT NULL CHECK (window_size BETWEEN 1 AND 3),
    vector halfvec(1024),
    text_for_lexical TSVECTOR,
    PRIMARY KEY (work_slug, chapter_num, para_num, window_size),
    FOREIGN KEY (work_slug, chapter_num, para_num) REFERENCES paragraphs(work_slug, chapter_num, para_num) ON DELETE CASCADE
);
-- Vector and lexical indexes built after bulk insert (см. Task 13).
CREATE INDEX IF NOT EXISTS embeddings_filter_idx ON embeddings(work_slug, chapter_num);

-- Agent observability
CREATE TABLE IF NOT EXISTS agent_runs (
    id BIGSERIAL PRIMARY KEY,
    thread_id TEXT,
    messages JSONB NOT NULL,
    citations_used JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_runs_thread_idx ON agent_runs(thread_id);

INSERT INTO schema_migrations(version) VALUES ('001_init') ON CONFLICT DO NOTHING;
