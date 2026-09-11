"use client";
import type { Health } from "@/lib/types";
import { useHealth } from "@/lib/useHealth";
import { Badge, type BadgeTone } from "./ui/Badge";
import { Tooltip } from "./ui/Tooltip";
import { Skeleton } from "./ui/Skeleton";

export interface ModePill { key: "data" | "llm" | "memory"; label: string; tone: BadgeTone; tooltip: string }

function llmPill(h: Health): ModePill {
  const active = h.llm.active;
  const detail = h.llm.detail ? ` (${h.llm.detail})` : "";
  switch (active) {
    case "rocketride":
      return h.rocketride.cloud
        ? { key: "llm", label: "RocketRide Cloud", tone: "accent", tooltip: `LLM: every planner, analyst and synthesizer call runs through the parallax-llm pipeline deployed on RocketRide Cloud${detail}.` }
        : { key: "llm", label: "RocketRide", tone: "accent", tooltip: `LLM: calls run through the parallax-llm pipeline on a RocketRide engine${h.rocketride.uri ? ` at ${h.rocketride.uri}` : ""}${detail}.` };
    case "anthropic":
      return { key: "llm", label: "Anthropic", tone: "info", tooltip: `LLM: Anthropic API${detail}. Configure RocketRide to route calls through a deployable pipeline.` };
    case "ollama":
      return { key: "llm", label: "Ollama", tone: "warn", tooltip: `LLM: local Ollama model${detail}. Fully offline, slower reasoning.` };
    case "fake":
      return { key: "llm", label: "Fake LLM", tone: "warn", tooltip: "LLM: deterministic FakeLLM (PARALLAX_LLM_MODE=fake) for smoke tests. Add an API key for real analysis." };
    default:
      return { key: "llm", label: "No LLM", tone: "danger", tooltip: "No healthy LLM provider. Configure ANTHROPIC_API_KEY, RocketRide, or a local Ollama model." };
  }
}

/** Human-readable pills for the three resolved subsystems. */
export function describeModes(h: Health): ModePill[] {
  const data: ModePill = h.data.kind === "hotdata"
    ? { key: "data", label: "Hotdata Cloud", tone: "cyan", tooltip: `Data: Hotdata Cloud${h.data.detail ? ` — ${h.data.detail}` : ""}. Each hypothesis gets an isolated database fork; agents query them concurrently.` }
    : { key: "data", label: "Local DuckDB", tone: "neutral", tooltip: "Data: local DuckDB files (fork = file copy). Set HOTDATA_API_KEY and HOTDATA_WORKSPACE_ID to fork on Hotdata Cloud." };
  const memory: ModePill = h.memory.kind === "cognee"
    ? { key: "memory", label: "Cognee", tone: "success", tooltip: "Memory: Cognee knowledge graph. Findings persist across runs and are recalled before planning." }
    : { key: "memory", label: "Local memory", tone: "neutral", tooltip: "Memory: local JSON + embeddings fallback. Configure Cognee (see Settings) for a persistent knowledge graph." };
  return [data, llmPill(h), memory];
}

export function ModeBadges({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { health, loading } = useHealth();

  if (loading && !health) {
    return (
      <div className={className} aria-busy="true" aria-label="Loading runtime modes">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-24 rounded-full" />)}
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className={className} role="status">
        <Tooltip side="bottom" content={<span>Backend unreachable — start it with <code className="mono text-accent-2">make dev</code></span>}>
          <Badge tone="danger" dot pulse tabIndex={0}>Backend offline</Badge>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={className} role="status" aria-label="Runtime modes">
      <div className="flex flex-wrap items-center gap-1.5">
        {describeModes(health).map((p) => (
          <Tooltip key={p.key} side="bottom" content={p.tooltip}>
            <Badge tone={p.tone} dot tabIndex={0}>
              {!compact && <span className="font-normal text-faint">{p.key}</span>}
              {p.label}
            </Badge>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
