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

# Pre-install torch+cpu from PyTorch's CPU-only wheel index BEFORE pip
# resolves the rest. Without this, sentence-transformers's torch dependency
# pulls the default GPU build with the full nvidia/CUDA stack (~5 GB of
# wheels we never load — the VPS has no GPU). With it, the subsequent
# `pip install .` sees torch is already satisfied and skips the CUDA pull.
RUN pip install --upgrade pip \
 && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

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

# Default to a single worker — bge-m3 in RAM is ~2GB per worker, so the
# right worker count is RAM-dependent and best set by the deployment.
# infra/docker-compose.prod.yml overrides this CMD with --workers 2 for
# the 32GB VPS; smaller hosts (or dev outside docker) keep the default.
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--proxy-headers"]
