-- 003_halfvec_bitquant.sql
-- Convert embeddings.vector from vector(1024) to halfvec(1024) and replace
-- the HNSW cosine index with a bit-quantized HNSW index for top-K candidate
-- selection. Semantic search becomes two-stage: bit-Hamming top-K → halfvec
-- cosine rerank.
--
-- Required: pgvector >= 0.7 (halfvec, binary_quantize, bit_hamming_ops).
-- Verify pre-flight:
--   SELECT extversion FROM pg_extension WHERE extname='vector';
--
-- Storage impact on prod 2M rows (measured pre-migration):
--   - vector(1024) column data:    ~8.2 GB  → halfvec(1024)  ~4.1 GB
--   - HNSW (m=8) cosine index:      12 GB   → bit-quant HNSW  ~1.5 GB
--   - Total DB:                     26 GB   → ~11-12 GB
--
-- Wall time (estimate, single-threaded ALTER + REINDEX):
--   - ALTER TYPE:                  10-20 min (rewrites all heap pages)
--   - DROP + CREATE INDEX (bit):   15-30 min
--   - Total downtime of vector search: 30-50 min

BEGIN;

-- Step 1: cast existing vectors to halfvec in place.
-- ALTER TYPE with USING rewrites all heap pages → slow on 2M rows.
ALTER TABLE embeddings
  ALTER COLUMN vector TYPE halfvec(1024)
  USING vector::halfvec(1024);

-- Step 2: drop the old HNSW index on the float32 vector.
DROP INDEX IF EXISTS embeddings_vector_idx;

-- Step 3: build a bit-quantized HNSW index. The expression
--   binary_quantize(vector)::bit(1024)
-- produces a 1024-bit signature; HNSW traverses these with Hamming
-- distance (operator <~>). Higher m / ef_construction than the old
-- cosine index because the bit-index is much smaller — we can afford
-- better recall params here.
CREATE INDEX embeddings_vector_idx
  ON embeddings
  USING hnsw ((binary_quantize(vector)::bit(1024)) bit_hamming_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;

-- Refresh planner stats; outside transaction.
ANALYZE embeddings;
