"""LLM protocol + JSON extraction helper (docs/SPEC.md §3.2)."""
from __future__ import annotations

import json
import re
from typing import Any, Protocol, runtime_checkable


class LLMError(Exception):
    pass


@runtime_checkable
class LLM(Protocol):
    name: str  # "rocketride" | "anthropic" | "ollama" | "fake"

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str: ...
    async def healthy(self) -> bool: ...


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_json(text: str) -> Any:
    """Tolerant JSON extraction: handles code fences, leading prose, trailing commentary."""
    if text is None:
        raise ValueError("empty LLM response")
    if isinstance(text, (dict, list)):
        return text
    s = text.strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    m = _FENCE.search(s)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except Exception:
            s = m.group(1).strip()
    # find first balanced {...} or [...]
    for opener, closer in (("{", "}"), ("[", "]")):
        start = s.find(opener)
        while start != -1:
            depth = 0
            in_str = False
            esc = False
            for i in range(start, len(s)):
                ch = s[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth == 0:
                        candidate = s[start:i + 1]
                        try:
                            return json.loads(candidate)
                        except Exception:
                            break
            start = s.find(opener, start + 1)
    raise ValueError(f"no JSON object found in LLM response: {s[:200]!r}")
