# Custom production image for the patristic backend.
#
# Replaces the previous `langgraph build` flow which inherited
# `langchain/langgraph-api` — that base image bundles a Postgres-backed
# checkpointer, Redis pubsub, and a worker queue we don't use. The
# frontend is fully stateless (full history in body, no thread_id), so
# we ship a minimal FastAPI server (backend.server:app) instead.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libpq for psycopg, build-essential for any wheels still needing a compiler.
# Keep this layer small; only what's needed at *runtime* in the final image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- builder stage: install Python deps + the local package ---
FROM base AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libpq-dev build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --upgrade pip \
 && pip install --no-cache-dir .

# --- runtime stage: copy site-packages + the app ---
FROM base AS runtime

# Bring over the installed packages and the editable code from the builder.
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app

# bge-m3 model + glossary live outside /app at runtime; mount via compose if
# you want a persistent HF cache (otherwise it downloads on first request).
ENV HF_HOME=/cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/cache/huggingface \
    PORT=8000

EXPOSE 8000

# Single worker — bge-m3 model in RAM is ~2GB; multi-worker would multiply
# that. The agent is async + I/O-bound, one process handles many concurrent
# runs via asyncio.
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--proxy-headers"]
