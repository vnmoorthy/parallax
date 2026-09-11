"""RocketRideLLM — every planner/agent/synth call goes through ``pipelines/parallax-llm.pipe`` on a RocketRide
engine (local Docker engine or RocketRide Cloud) via the official ``rocketride`` SDK (docs/SPEC.md §3.2, §7).

Lifecycle: connect lazily → ``use(pipeline=…)`` once (token cached, long TTL) → ``chat(token, Question)`` per
call. Any failure raises ``LLMError`` so the router falls back, and drops the cached client/token so the next
call reconnects (tokens expire when the pipeline idles past its TTL).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from app.config import REPO_ROOT, settings
from app.llm.base import LLMError

log = logging.getLogger("parallax.llm.rocketride")

_PLACEHOLDER_RE = re.compile(r"\$\{(ROCKETRIDE_[A-Z0-9_]+)\}")
CONNECT_TIMEOUT_MS = 10_000
USE_TIMEOUT_S = 90.0
CHAT_TIMEOUT_S = 240.0
HEALTH_TIMEOUT_S = 5.0


def substitute_placeholders(obj: Any, env: dict[str, str]) -> Any:
    """Replace ``${ROCKETRIDE_*}`` placeholders present in ``env``; unknown ones are left for the engine."""
    if isinstance(obj, str):
        return _PLACEHOLDER_RE.sub(lambda m: env.get(m.group(1), m.group(0)), obj)
    if isinstance(obj, list):
        return [substitute_placeholders(x, env) for x in obj]
    if isinstance(obj, dict):
        return {k: substitute_placeholders(v, env) for k, v in obj.items()}
    return obj


def extract_answer(resp: Any) -> Any:
    """``response["data"]["answer"]`` → ``response["answers"][0]`` → sensible fallbacks. Returns str|dict|list|None."""
    if resp is None:
        return None
    if isinstance(resp, (str, list)) and not isinstance(resp, dict):
        return resp[0] if isinstance(resp, list) and resp else resp
    if not isinstance(resp, dict):
        return str(resp)
    data = resp.get("data")
    if isinstance(data, dict):
        for key in ("answer", "text", "content"):
            if data.get(key) not in (None, "", []):
                return data[key]
        if data.get("answers"):
            return extract_answer({"answers": data["answers"]})
    answers = resp.get("answers")
    if isinstance(answers, list) and answers:
        first = answers[0]
        if isinstance(first, dict):
            for key in ("answer", "text", "content"):
                if first.get(key) not in (None, "", []):
                    return first[key]
            return first
        return first
    for key in ("answer", "text"):
        if resp.get(key) not in (None, "", []):
            return resp[key]
    return None


class RocketRideLLM:
    name = "rocketride"

    def __init__(self, uri: str | None = None, apikey: str | None = None, pipe_path: str | Path | None = None,
                 *, ttl: int = 3600):
        self._uri = uri or settings.rocketride_uri
        self._apikey = apikey or settings.rocketride_apikey
        pipe = Path(pipe_path or settings.rocketride_llm_pipe)
        self._pipe = pipe if pipe.is_absolute() else REPO_ROOT / pipe
        self._ttl = ttl
        self._client: Any = None
        self._token: str | None = None
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    @property
    def configured(self) -> bool:
        return bool(self._uri and self._apikey)

    @property
    def pipe_path(self) -> Path:
        return self._pipe

    def _alock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock, self._lock_loop = asyncio.Lock(), loop
        return self._lock

    # ── pipeline handling ───────────────────────────────────────────────────
    def _rocket_env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k.startswith("ROCKETRIDE_")}
        key = settings.effective_rocketride_anthropic_key
        if key:
            env.setdefault("ROCKETRIDE_ANTHROPIC_KEY", key)
        return env

    def _load_pipeline(self, env: dict[str, str]) -> dict[str, Any]:
        if not self._pipe.exists():
            raise LLMError(f"RocketRide pipeline file not found: {self._pipe}")
        try:
            raw = json.loads(self._pipe.read_text("utf-8"))
        except json.JSONDecodeError as exc:
            raise LLMError(f"RocketRide pipeline {self._pipe.name} is not valid JSON: {exc}") from exc
        if isinstance(raw, dict) and isinstance(raw.get("pipeline"), dict):
            raw = raw["pipeline"]
        if not isinstance(raw, dict) or not raw.get("components"):
            raise LLMError(f"RocketRide pipeline {self._pipe.name} has no components")
        return substitute_placeholders(raw, env)

    def missing_placeholders(self) -> list[str]:
        """``${ROCKETRIDE_*}`` names used by the pipe that cannot be resolved from the environment."""
        try:
            env = self._rocket_env()
            text = json.dumps(self._load_pipeline(env))
        except LLMError:
            return []
        return sorted({m.group(1) for m in _PLACEHOLDER_RE.finditer(text) if m.group(1) not in env})

    async def _ensure(self) -> None:
        if not self.configured:
            raise LLMError("RocketRide is not configured (set ROCKETRIDE_URI and ROCKETRIDE_APIKEY)")
        if self._client is not None and self._token:
            return
        env = self._rocket_env()
        pipeline = self._load_pipeline(env)
        missing = self.missing_placeholders()
        if missing:
            raise LLMError(f"RocketRide pipeline {self._pipe.name} needs unset variables: {', '.join(missing)} "
                           "(ROCKETRIDE_ANTHROPIC_KEY falls back to ANTHROPIC_API_KEY)")
        from rocketride import RocketRideClient  # slow import — only pay for it when we are about to connect
        client = RocketRideClient(uri=self._uri, auth=self._apikey, persist=False, env={**os.environ, **env},
                                  request_timeout=int(CHAT_TIMEOUT_S * 1000))
        try:
            await asyncio.wait_for(client.connect(self._apikey, timeout=CONNECT_TIMEOUT_MS),
                                   timeout=CONNECT_TIMEOUT_MS / 1000 + 5)
            result = await asyncio.wait_for(
                client.use(pipeline=pipeline, name=self._pipe.stem, ttl=self._ttl, env=env),
                timeout=USE_TIMEOUT_S)
        except Exception:
            try:
                await client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            raise
        token = (result or {}).get("token") if isinstance(result, dict) else None
        if not token:
            try:
                await client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            raise LLMError(f"RocketRide use() returned no token: {result!r}")
        self._client, self._token = client, str(token)
        log.info("rocketride pipeline %s started (token %s…)", self._pipe.name, self._token[:8])

    async def _reset(self) -> None:
        client, token = self._client, self._token
        self._client, self._token = None, None
        if client is None:
            return
        try:
            if token:
                await asyncio.wait_for(client.terminate(token), timeout=5)
        except Exception:  # noqa: BLE001
            pass
        try:
            await asyncio.wait_for(client.disconnect(), timeout=5)
        except Exception:  # noqa: BLE001
            pass

    # ── LLM protocol ────────────────────────────────────────────────────────
    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        try:
            async with self._alock():
                await self._ensure()
            from rocketride.schema import Question

            question = Question(expectJson=bool(json_mode))
            if system:
                question.addInstruction("System", system)
            question.addQuestion(user)
            resp = await asyncio.wait_for(self._client.chat(token=self._token, question=question), timeout=CHAT_TIMEOUT_S)
            answer = extract_answer(resp)
            if answer in (None, "", [], {}):
                raise LLMError(f"RocketRide returned no answer: {str(resp)[:200]}")
            return answer if isinstance(answer, str) else json.dumps(answer)
        except LLMError:
            raise
        except Exception as exc:  # noqa: BLE001 — any SDK/transport failure → fallback
            await self._reset()
            raise LLMError(f"rocketride: {type(exc).__name__}: {exc}") from exc

    async def healthy(self) -> bool:
        """Never hangs: HTTP ``/ping`` with a 5s timeout, then a 5s SDK probe for engines without ``/ping``."""
        if not self.configured:
            return False
        if not self._pipe.exists():
            log.warning("rocketride pipeline file missing: %s", self._pipe)
            return False
        missing = self.missing_placeholders()
        if missing:
            log.warning("rocketride pipeline %s needs %s — provider disabled until set", self._pipe.name, ", ".join(missing))
            return False
        base = self._uri.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=HEALTH_TIMEOUT_S) as client:
                r = await client.get(f"{base}/ping")
            if r.status_code < 500:
                return True
        except Exception as exc:  # noqa: BLE001
            log.debug("rocketride /ping failed: %s", exc)
        try:
            from rocketride import RocketRideClient

            await asyncio.wait_for(RocketRideClient.get_server_info(self._uri, timeout=HEALTH_TIMEOUT_S * 1000),
                                   timeout=HEALTH_TIMEOUT_S + 2)
            return True
        except Exception as exc:  # noqa: BLE001
            log.info("rocketride not reachable at %s: %s", self._uri, exc)
            return False

    async def aclose(self) -> None:
        await self._reset()
