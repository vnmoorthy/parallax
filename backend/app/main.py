"""FastAPI app factory: CORS, routers, lifespan, error handlers. `uvicorn app.main:app`."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import AppContainer, install_exception_handlers, router
from app.config import Settings
from app.config import settings as default_settings
from app.datasets import DatasetRegistry
from app.swarm.events import EventBus
from app.swarm.store import RunStore

log = logging.getLogger("parallax")


def create_app(*, engine: Any = None, llm: Any = None, memory: Any = None, store: RunStore | None = None,
               bus: EventBus | None = None, registry: DatasetRegistry | None = None,
               settings: Settings | None = None) -> FastAPI:
    """Build the app. Without overrides, engine/llm/memory are created lazily via their factories on first use."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = settings or default_settings

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("Parallax backend %s starting (data=%s llm=%s memory=%s, data dir %s)", s.parallax_version,
                 s.parallax_data_mode, s.parallax_llm_mode, s.parallax_memory_mode, s.parallax_data_dir)
        try:
            n = app.state.container.store.mark_interrupted()
            if n:
                log.warning("marked %d interrupted run(s) as failed", n)
        except Exception:  # noqa: BLE001
            log.exception("startup run cleanup failed")
        yield
        await app.state.container.shutdown()

    app = FastAPI(title="Parallax", version=s.parallax_version, lifespan=lifespan,
                  description="Many agents. Many branches. One answer.")
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    install_exception_handlers(app)
    app.include_router(router)
    app.state.container = AppContainer(engine=engine, llm=llm, memory=memory, store=store, bus=bus,
                                       registry=registry, settings=s)
    app.state.tasks = app.state.container.tasks

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, Any]:
        return {"name": "parallax", "version": s.parallax_version, "docs": "/docs", "api": "/api/health"}

    return app


app = create_app()
