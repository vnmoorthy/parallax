"""AnthropicLLM — Claude through the official ``anthropic`` SDK (docs/SPEC.md §3.2)."""
from __future__ import annotations

import logging
from typing import Any

from app.config import settings
from app.llm.base import LLMError

log = logging.getLogger("parallax.llm.anthropic")

JSON_SUFFIX = "Respond with a single JSON object only."


class AnthropicLLM:
    name = "anthropic"

    def __init__(self, api_key: str | None = None, model: str | None = None, *, timeout: float = 120.0,
                 max_retries: int = 2):
        self._api_key = api_key or settings.anthropic_api_key
        self._model = model or settings.anthropic_model
        self._timeout = timeout
        self._max_retries = max_retries
        self._client: Any = None

    @property
    def model(self) -> str:
        return self._model

    def _get_client(self) -> Any:
        if self._client is None:
            import anthropic  # local import keeps zero-key startup fast

            self._client = anthropic.AsyncAnthropic(api_key=self._api_key, timeout=self._timeout,
                                                    max_retries=self._max_retries)
        return self._client

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        if not self._api_key:
            raise LLMError("ANTHROPIC_API_KEY is not set")
        import anthropic

        sys_prompt = f"{system.rstrip()}\n\n{JSON_SUFFIX}" if json_mode else system
        try:
            resp = await self._get_client().messages.create(
                model=self._model,
                max_tokens=int(max_tokens),
                system=sys_prompt,
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.APIStatusError as exc:
            raise LLMError(f"anthropic {exc.status_code}: {getattr(exc, 'message', exc)}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError(f"anthropic connection error: {exc}") from exc
        except anthropic.AnthropicError as exc:
            raise LLMError(f"anthropic error: {exc}") from exc
        except Exception as exc:  # noqa: BLE001 — router falls back on any failure
            raise LLMError(f"anthropic unexpected error: {type(exc).__name__}: {exc}") from exc
        text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", None) == "text")
        if not text.strip():
            reason = getattr(resp, "stop_reason", None)
            raise LLMError(f"anthropic returned no text (stop_reason={reason})")
        return text

    async def healthy(self) -> bool:
        return bool(self._api_key)
