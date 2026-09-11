"""DataEngine factory: picks Hotdata when configured + reachable, otherwise the local DuckDB engine (SPEC §2)."""
from __future__ import annotations

import logging
import time
from typing import Any

from app.config import settings
from app.data.base import DataEngine, DataEngineError
from app.data.hotdata import HotdataEngine
from app.data.local import LocalEngine

log = logging.getLogger("parallax.data.factory")

_engine: DataEngine | None = None
_detail: str = "not initialised"
_probe: tuple[float, bool] | None = None  # (monotonic ts, reachable)
_PROBE_TTL_S = 30.0


async def _hotdata_reachable(engine: HotdataEngine | None = None) -> bool:
    """Cached (30s) reachability probe so /health stays cheap."""
    global _probe
    if _probe and time.monotonic() - _probe[0] < _PROBE_TTL_S:
        return _probe[1]
    owned = engine is None
    eng = engine or HotdataEngine()
    try:
        ok = await eng.healthy()
    finally:
        if owned:
            await eng.aclose()
    _probe = (time.monotonic(), ok)
    return ok


async def get_engine() -> DataEngine:
    """Cached singleton. ``PARALLAX_DATA_MODE``: auto | hotdata | local."""
    global _engine, _detail
    if _engine is not None:
        return _engine
    mode = (settings.parallax_data_mode or "auto").strip().lower()
    if mode == "hotdata":
        if not settings.hotdata_configured:
            raise DataEngineError("PARALLAX_DATA_MODE=hotdata but HOTDATA_API_KEY / HOTDATA_WORKSPACE_ID are not set")
        _engine = HotdataEngine()
        _detail = f"Hotdata Cloud ({settings.hotdata_api_url}) — forced by PARALLAX_DATA_MODE"
    elif mode == "local":
        _engine = LocalEngine()
        _detail = f"local DuckDB files under {settings.dbs_dir}"
    elif mode == "auto":
        if settings.hotdata_configured:
            candidate = HotdataEngine()
            if await _hotdata_reachable(candidate):
                _engine = candidate
                _detail = f"Hotdata Cloud ({settings.hotdata_api_url})"
            else:
                await candidate.aclose()
                _engine = LocalEngine()
                _detail = "Hotdata configured but unreachable — using local DuckDB"
        else:
            _engine = LocalEngine()
            _detail = "no Hotdata credentials — using local DuckDB"
    else:
        raise DataEngineError(f"unknown PARALLAX_DATA_MODE {mode!r} (use auto|hotdata|local)")
    log.info("data engine: %s (%s)", _engine.kind, _detail)
    return _engine


async def engine_status() -> dict[str, Any]:
    """Payload for GET /api/health → ``data``."""
    try:
        eng = await get_engine()
        kind, detail = eng.kind, _detail
    except DataEngineError as exc:
        kind, detail = "unavailable", str(exc)
    reachable: bool | None = None
    if settings.hotdata_configured:
        try:
            reachable = await _hotdata_reachable(_engine if isinstance(_engine, HotdataEngine) else None)
        except Exception as exc:  # noqa: BLE001
            log.info("hotdata probe failed: %s", exc)
            reachable = False
    return {
        "mode": settings.parallax_data_mode,
        "kind": kind,
        "detail": detail,
        "hotdata": {"configured": settings.hotdata_configured, "reachable": reachable},
    }


def reset_engine() -> None:
    """Forget the cached engine (tests / settings changes)."""
    global _engine, _detail, _probe
    _engine = None
    _detail = "not initialised"
    _probe = None
