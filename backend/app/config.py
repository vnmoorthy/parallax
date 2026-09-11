"""Parallax settings. Everything is optional — the app runs with zero keys in local mode (docs/SPEC.md §2)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Load repo-root .env first, then backend/.env (backend wins). Never override real env vars.
for _p in (REPO_ROOT / ".env", BACKEND_DIR / ".env"):
    if _p.exists():
        load_dotenv(_p, override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    # ── modes ────────────────────────────────────────────────────────────
    parallax_data_mode: str = Field(default="auto")      # auto | hotdata | local
    parallax_llm_mode: str = Field(default="auto")       # auto | rocketride | anthropic | ollama | fake
    parallax_memory_mode: str = Field(default="auto")    # auto | cognee | local
    parallax_data_dir: Path = Field(default=REPO_ROOT / ".parallax")
    parallax_max_agents: int = Field(default=16)
    parallax_local_vector_rows: int = Field(default=1500)   # local mode: rows embedded for semantic search (0 = all)
    parallax_version: str = Field(default="0.1.0")

    # ── Hotdata ──────────────────────────────────────────────────────────
    hotdata_api_key: str | None = None
    hotdata_workspace_id: str | None = None
    hotdata_api_url: str = "https://api.hotdata.dev/v1"

    # ── LLMs ─────────────────────────────────────────────────────────────
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-4-5"
    openai_api_key: str | None = None
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"
    ollama_embed_model: str = "nomic-embed-text"

    # ── RocketRide ───────────────────────────────────────────────────────
    rocketride_uri: str | None = None          # https://api.rocketride.ai or http://localhost:5565
    rocketride_apikey: str | None = None
    rocketride_anthropic_key: str | None = None
    rocketride_llm_pipe: str = "pipelines/parallax-llm.pipe"
    rocketride_analyst_pipe: str = "pipelines/parallax-analyst.pipe"

    # ── Cognee ───────────────────────────────────────────────────────────
    cognee_base_url: str | None = None          # only used by RocketRide tool_cognee / docs
    llm_provider: str | None = None             # cognee's own LLM_* / EMBEDDING_* vars (passthrough)
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_endpoint: str | None = None
    embedding_provider: str | None = None
    embedding_model: str | None = None
    embedding_endpoint: str | None = None
    embedding_dimensions: int | None = None

    # ── derived helpers ──────────────────────────────────────────────────
    @property
    def runs_dir(self) -> Path:
        p = self.parallax_data_dir / "runs"; p.mkdir(parents=True, exist_ok=True); return p

    @property
    def dbs_dir(self) -> Path:
        p = self.parallax_data_dir / "dbs"; p.mkdir(parents=True, exist_ok=True); return p

    @property
    def uploads_dir(self) -> Path:
        p = self.parallax_data_dir / "uploads"; p.mkdir(parents=True, exist_ok=True); return p

    @property
    def memory_dir(self) -> Path:
        p = self.parallax_data_dir / "memory"; p.mkdir(parents=True, exist_ok=True); return p

    @property
    def datasets_dir(self) -> Path:
        return REPO_ROOT / "datasets"

    @property
    def pipelines_dir(self) -> Path:
        return REPO_ROOT / "pipelines"

    @property
    def hotdata_configured(self) -> bool:
        return bool(self.hotdata_api_key and self.hotdata_workspace_id)

    @property
    def rocketride_configured(self) -> bool:
        return bool(self.rocketride_uri and self.rocketride_apikey)

    @property
    def rocketride_is_cloud(self) -> bool:
        return bool(self.rocketride_uri and "rocketride.ai" in self.rocketride_uri)

    @property
    def effective_rocketride_anthropic_key(self) -> str | None:
        return self.rocketride_anthropic_key or self.anthropic_api_key


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.parallax_data_dir.mkdir(parents=True, exist_ok=True)
    # Make ${ROCKETRIDE_ANTHROPIC_KEY} substitutable for .pipe files even if only ANTHROPIC_API_KEY was set.
    if s.effective_rocketride_anthropic_key and not os.environ.get("ROCKETRIDE_ANTHROPIC_KEY"):
        os.environ["ROCKETRIDE_ANTHROPIC_KEY"] = s.effective_rocketride_anthropic_key
    if s.hotdata_api_key and not os.environ.get("ROCKETRIDE_DB_HOTDATA_KEY"):
        os.environ["ROCKETRIDE_DB_HOTDATA_KEY"] = s.hotdata_api_key
    if s.hotdata_workspace_id and not os.environ.get("ROCKETRIDE_DB_HOTDATA_WORKSPACE_ID"):
        os.environ["ROCKETRIDE_DB_HOTDATA_WORKSPACE_ID"] = s.hotdata_workspace_id
    return s


settings = get_settings()
