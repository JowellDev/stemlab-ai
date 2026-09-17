# syntax=docker/dockerfile:1
# ffmpeg est requis par le pipeline (normalisation + encodage Opus).
FROM python:3.12-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app

# ---- deps ----------------------------------------------------------------
FROM base AS deps
COPY apps/ml/pyproject.toml apps/ml/uv.lock apps/ml/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --extra ml

# ---- dev : sources montees en volume --------------------------------------
FROM deps AS dev
COPY apps/ml/ ./
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "ml.api:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---- runtime --------------------------------------------------------------
FROM deps AS runtime
COPY apps/ml/ ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --extra ml
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "ml.api:app", "--host", "0.0.0.0", "--port", "8000"]
