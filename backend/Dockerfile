# Parallax backend — FastAPI on Python 3.12 (uv-managed, slim)
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:${PATH}"

# curl for the compose healthcheck; build-essential only if a wheel is missing for cognee/duckdb deps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

# Dependency layer (cached until pyproject/uv.lock change). --no-install-project: the app is copied next.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Application
COPY app ./app
RUN uv sync --frozen --no-dev

# Runtime data (runs, DuckDB files, uploads). Mounted from the host in docker-compose.
RUN mkdir -p /app/.parallax /app/datasets /app/pipelines
ENV PARALLAX_DATA_DIR=/app/.parallax

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
