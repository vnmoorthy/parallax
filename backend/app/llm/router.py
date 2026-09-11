"""LLM router: builds the provider chain from ``PARALLAX_LLM_MODE`` and falls back per call (docs/SPEC.md §3.2).

auto  → [rocketride (if configured), anthropic (if key), ollama (if reachable), fake]
mode  → only that provider (no fake fallback); ``fake`` → FakeLLM only.

Health is probed once per provider (cached). A provider that fails a call is put on a short cooldown so a swarm
of concurrent agents does not keep hammering a dead endpoint; it is retried once the cooldown lapses.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.config import settings
from app.llm.anthropic_llm import AnthropicLLM
from app.llm.base import LLM, LLMError, extract_json
from app.llm.fake_llm import FakeLLM
from app.llm.ollama_llm import OllamaLLM
from app.llm.rocketride_llm import RocketRideLLM

__all__ = ["RoutedLLM", "build_chain", "get_llm", "llm_status", "reset_llm", "extract_json"]

log = logging.getLogger("parallax.llm.router")

HEALTH_TIMEOUT_S = 8.0
COOLDOWN_S = 30.0
VALID_MODES = ("auto", "rocketride", "anthropic", "ollama", "fake")


def build_chain(mode: str | None = None) -> list[LLM]:
    mode = (mode or settings.parallax_llm_mode or "auto").strip().lower()
    if mode == "auto":
        chain: list[LLM] = []
        if settings.rocketride_configured:
            chain.append(RocketRideLLM())
        if settings.anthropic_api_key:
            chain.append(AnthropicLLM())
        chain.append(OllamaLLM())
        chain.append(FakeLLM())
        return chain
    if mode == "rocketride":
        if not settings.rocketride_configured:
            raise LLMError("PARALLAX_LLM_MODE=rocketride but ROCKETRIDE_URI / ROCKETRIDE_APIKEY are not set")
        return [RocketRideLLM()]
    if mode == "anthropic":
        if not settings.anthropic_api_key:
            raise LLMError("PARALLAX_LLM_MODE=anthropic but ANTHROPIC_API_KEY is not set")
        return [AnthropicLLM()]
    if mode == "ollama":
        return [OllamaLLM()]
    if mode == "fake":
        return [FakeLLM()]
    raise LLMError(f"unknown PARALLAX_LLM_MODE {mode!r} (use {'|'.join(VALID_MODES)})")


class RoutedLLM:
    """Tries providers in order; records which one served each call."""

    name = "routed"

    def __init__(self, providers: list[LLM], *, mode: str = "auto", cooldown_s: float = COOLDOWN_S):
        if not providers:
            raise LLMError("LLM chain is empty")
        self.providers = list(providers)
        self.mode = mode
        self.cooldown_s = cooldown_s
        self.calls_by_provider: dict[str, int] = {}
        self.errors_by_provider: dict[str, int] = {}
        self.last_provider: str | None = None
        self.last_error: str | None = None
        self._health: dict[str, bool] = {}
        self._health_done = False
        self._health_lock: asyncio.Lock | None = None
        self._health_loop: asyncio.AbstractEventLoop | None = None
        self._cooldown_until: dict[str, float] = {}

    @property
    def chain(self) -> list[str]:
        return [p.name for p in self.providers]

    def _lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._health_lock is None or self._health_loop is not loop:
            self._health_lock, self._health_loop = asyncio.Lock(), loop
        return self._health_lock

    async def _probe(self, p: LLM) -> bool:
        try:
            return bool(await asyncio.wait_for(p.healthy(), timeout=HEALTH_TIMEOUT_S))
        except Exception as exc:  # noqa: BLE001
            log.info("health probe for %s failed: %s", p.name, exc)
            return False

    async def ensure_health(self) -> dict[str, bool]:
        """Probe every provider once (cached). Safe to call concurrently."""
        if self._health_done:
            return self._health
        async with self._lock():
            if not self._health_done:
                results = await asyncio.gather(*(self._probe(p) for p in self.providers))
                self._health = {p.name: ok for p, ok in zip(self.providers, results)}
                self._health_done = True
                log.info("llm chain health: %s", self._health)
        return self._health

    async def active_providers(self) -> list[LLM]:
        health = await self.ensure_health()
        healthy = [p for p in self.providers if health.get(p.name)]
        return healthy or list(self.providers)  # nothing healthy → still try everything

    async def active_name(self) -> str | None:
        health = await self.ensure_health()
        return next((p.name for p in self.providers if health.get(p.name)), None)

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        chain = await self.active_providers()
        now = time.monotonic()
        ready = [p for p in chain if self._cooldown_until.get(p.name, 0.0) <= now]
        order = ready + [p for p in chain if p not in ready]  # cooled-down providers are last resort, not excluded
        errors: list[str] = []
        for p in order:
            try:
                text = await p.complete(system, user, json_mode=json_mode, max_tokens=max_tokens)
            except Exception as exc:  # noqa: BLE001 — LLMError or anything else: log and move on
                msg = f"{p.name}: {exc}"
                errors.append(msg)
                self.errors_by_provider[p.name] = self.errors_by_provider.get(p.name, 0) + 1
                self.last_error = msg
                if len(order) > 1:
                    self._cooldown_until[p.name] = time.monotonic() + self.cooldown_s
                log.warning("llm provider %s failed (%s); falling back", p.name, exc)
                continue
            self._cooldown_until.pop(p.name, None)
            self.calls_by_provider[p.name] = self.calls_by_provider.get(p.name, 0) + 1
            self.last_provider = p.name
            return text
        raise LLMError("all LLM providers failed: " + "; ".join(errors))

    async def complete_json(self, system: str, user: str, *, max_tokens: int = 2000) -> Any:
        """Convenience: ``complete(json_mode=True)`` + tolerant JSON extraction."""
        return extract_json(await self.complete(system, user, json_mode=True, max_tokens=max_tokens))

    async def healthy(self) -> bool:
        return any((await self.ensure_health()).values())

    async def status(self) -> dict[str, Any]:
        health = await self.ensure_health()
        active = await self.active_name()
        if active is None:
            detail = f"mode={self.mode}: no provider is healthy"
        else:
            detail = f"mode={self.mode}: {active} serves calls; fallback order {' → '.join(self.chain)}"
        return {
            "chain": self.chain,
            "active": active,
            "detail": detail,
            "mode": self.mode,
            "health": health,
            "calls_by_provider": dict(self.calls_by_provider),
            "last_provider": self.last_provider,
        }


_llm: RoutedLLM | None = None


def get_llm() -> RoutedLLM:
    """Cached singleton built from ``settings.parallax_llm_mode``."""
    global _llm
    if _llm is None:
        mode = (settings.parallax_llm_mode or "auto").strip().lower()
        _llm = RoutedLLM(build_chain(mode), mode=mode)
        log.info("llm chain (%s): %s", mode, _llm.chain)
    return _llm


async def llm_status() -> dict[str, Any]:
    """Payload for GET /api/health → ``llm``: ``{"chain": [...], "active": name|None, "detail": str}``."""
    try:
        return await get_llm().status()
    except LLMError as exc:
        return {"chain": [], "active": None, "detail": str(exc), "mode": settings.parallax_llm_mode}


def reset_llm() -> None:
    global _llm
    _llm = None
