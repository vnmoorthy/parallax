"""Memory protocol (docs/SPEC.md §3.3)."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Protocol, runtime_checkable


@dataclass
class MemoryHit:
    text: str
    score: float
    tags: list[str]
    created_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@runtime_checkable
class Memory(Protocol):
    kind: str  # "cognee" | "local"

    async def remember(self, text: str, *, tags: list[str]) -> None: ...
    async def recall(self, query: str, *, tags: list[str] | None = None, k: int = 8) -> list[MemoryHit]: ...
    async def stats(self) -> dict[str, Any]: ...
    async def graph_html(self) -> str | None: ...
    async def healthy(self) -> bool: ...
