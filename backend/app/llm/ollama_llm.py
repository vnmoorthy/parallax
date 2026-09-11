"""OllamaLLM — local models through ollama's /api/chat (docs/SPEC.md §3.2)."""
from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.llm.base import LLMError

log = logging.getLogger("parallax.llm.ollama")


async def ollama_tags(host: str | None = None, timeout: float = 2.0) -> list[str] | None:
    """Model names known to the ollama daemon, or ``None`` when it is not reachable."""
    base = (host or settings.ollama_host).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(f"{base}/api/tags")
        if r.status_code != 200:
            return None
        return [str(m.get("name") or m.get("model") or "") for m in r.json().get("models", [])]
    except Exception as exc:  # noqa: BLE001 — unreachable is a normal state
        log.debug("ollama not reachable at %s: %s", base, exc)
        return None


def model_available(tags: list[str] | None, model: str) -> bool:
    """Prefix match: ``llama3.1`` matches ``llama3.1:8b``; ``llama3.1:8b`` matches itself."""
    if not tags or not model:
        return False
    return any(t == model or t.startswith(model + ":") or t.split(":", 1)[0] == model for t in tags)


class OllamaLLM:
    name = "ollama"

    def __init__(self, host: str | None = None, model: str | None = None, *, timeout: float = 360.0,
                 num_ctx: int = 8192, temperature: float = 0.2):
        self._host = (host or settings.ollama_host).rstrip("/")
        self._model = model or settings.ollama_model
        self._timeout = timeout
        self._num_ctx = num_ctx
        self._temperature = temperature

    @property
    def model(self) -> str:
        return self._model

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        payload: dict = {
            "model": self._model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "options": {"num_ctx": self._num_ctx, "temperature": self._temperature, "num_predict": int(max_tokens)},
        }
        if json_mode:
            payload["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.post(f"{self._host}/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            raise LLMError(f"ollama timed out after {self._timeout:.0f}s on model {self._model} "
                           f"(prompt {len(system) + len(user):,} chars)") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"ollama unreachable at {self._host}: {type(exc).__name__}: {exc}") from exc
        if r.status_code != 200:
            raise LLMError(f"ollama /api/chat {r.status_code}: {r.text[:300]}")
        try:
            content = (r.json().get("message") or {}).get("content") or ""
        except ValueError as exc:
            raise LLMError(f"ollama returned non-JSON: {r.text[:200]}") from exc
        if not content.strip():
            raise LLMError("ollama returned an empty completion")
        return content

    async def healthy(self) -> bool:
        tags = await ollama_tags(self._host)
        if tags is None:
            return False
        ok = model_available(tags, self._model)
        if not ok:
            log.warning("ollama is up but model %r is not pulled (have: %s)", self._model, ", ".join(tags[:8]))
        return ok
