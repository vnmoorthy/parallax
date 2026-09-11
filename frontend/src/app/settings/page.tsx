"use client";
import * as React from "react";
import { Brain, Cpu, Database, ExternalLink, FileKey, RefreshCw, Rocket, Server } from "lucide-react";
import { API_URL } from "@/lib/api";
import type { Health } from "@/lib/types";
import { useHealth } from "@/lib/useHealth";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Skeleton } from "@/components/ui/Skeleton";

const ENV_TEMPLATE = `# ── Parallax environment (.env at repo root) ─────────────────────────
# Everything is optional. With zero keys Parallax runs fully local:
# DuckDB forks + Ollama (or FakeLLM) + local memory.

# Data engine: auto | hotdata | local
PARALLAX_DATA_MODE=auto
HOTDATA_API_KEY=
HOTDATA_WORKSPACE_ID=
HOTDATA_API_URL=https://api.hotdata.dev/v1

# LLM routing: auto | rocketride | anthropic | ollama   (chain: rocketride → anthropic → ollama)
PARALLAX_LLM_MODE=auto
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5

# RocketRide engine — Cloud: https://api.rocketride.ai · local Docker: http://localhost:5565 (key MYAPIKEY)
ROCKETRIDE_URI=https://api.rocketride.ai
ROCKETRIDE_APIKEY=
ROCKETRIDE_ANTHROPIC_KEY=          # substituted into pipelines/*.pipe; falls back to ANTHROPIC_API_KEY

# Ollama — local LLM + embeddings
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_EMBED_MODEL=nomic-embed-text

# Memory: auto | cognee | local
PARALLAX_MEMORY_MODE=auto
# Cognee's own config — needs BOTH an LLM and an embedding provider
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5
LLM_API_KEY=                       # defaults to ANTHROPIC_API_KEY
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text:latest
EMBEDDING_ENDPOINT=http://localhost:11434/api/embed
EMBEDDING_DIMENSIONS=768
COGNEE_BASE_URL=                   # optional remote Cognee server

# Storage & limits
PARALLAX_DATA_DIR=.parallax
PARALLAX_MAX_AGENTS=16

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_MOCK=0
`;

interface Connection {
  id: string;
  name: string;
  icon: React.ReactNode;
  status: { tone: BadgeTone; label: string };
  powers: string;
  env: string;
  docs: { label: string; href: string };
  extra?: React.ReactNode;
}

const providerName: Record<string, string> = { rocketride: "RocketRide", anthropic: "Anthropic", ollama: "Ollama", fake: "Fake LLM" };

function connections(h: Health | null, offline: boolean): Connection[] {
  const unknown = { tone: "neutral" as BadgeTone, label: offline ? "Unknown · backend offline" : "Checking…" };

  const hotdata: Connection["status"] = !h ? unknown
    : h.data.kind === "hotdata" ? { tone: "success", label: `Connected · Hotdata Cloud${h.data.detail ? ` · ${h.data.detail}` : ""}` }
    : h.hotdata?.configured && !h.hotdata.reachable ? { tone: "warn", label: "Configured · unreachable" }
    : { tone: "neutral", label: "Local fallback · DuckDB" };

  const rocketride: Connection["status"] = !h ? unknown
    : h.rocketride.reachable ? { tone: "success", label: `Connected · ${h.rocketride.cloud ? "RocketRide Cloud" : h.rocketride.uri || "local engine"}` }
    : h.rocketride.configured ? { tone: "warn", label: "Configured · unreachable" }
    : { tone: "neutral", label: "Not configured" };

  const cognee: Connection["status"] = !h ? unknown
    : h.memory.kind === "cognee" ? { tone: "success", label: `Active · Cognee${h.memory.detail ? ` · ${h.memory.detail}` : ""}` }
    : h.cognee?.configured ? { tone: "warn", label: "Configured · init failed → local memory" }
    : { tone: "neutral", label: "Local fallback · JSON + embeddings" };

  const llm: Connection["status"] = !h ? unknown
    : h.llm.active === "fake" ? { tone: "warn", label: "Fake LLM · smoke-test mode" }
    : h.llm.active ? { tone: "success", label: `Active · ${providerName[h.llm.active] ?? h.llm.active}${h.llm.detail ? ` · ${h.llm.detail}` : ""}` }
    : { tone: "danger", label: "No healthy provider" };

  return [
    {
      id: "hotdata", name: "Hotdata", icon: <Database />, status: hotdata,
      powers: "The data plane. Parallax creates one database per run, forks it per hypothesis (copy-on-write), and lets every agent run SQL, BM25 and vector search concurrently against its own branch.",
      env: "HOTDATA_API_KEY=\nHOTDATA_WORKSPACE_ID=\n# optional\nHOTDATA_API_URL=https://api.hotdata.dev/v1\nPARALLAX_DATA_MODE=auto",
      docs: { label: "hotdata.dev/docs", href: "https://www.hotdata.dev/docs" },
    },
    {
      id: "rocketride", name: "RocketRide", icon: <Rocket />, status: rocketride,
      powers: "Analyst reasoning as a deployable pipeline. Planner, agent and synthesizer calls route through pipelines/parallax-llm.pipe; parallax-analyst.pipe is deployable to RocketRide Cloud with Hotdata + Cognee tools.",
      env: "ROCKETRIDE_URI=https://api.rocketride.ai\nROCKETRIDE_APIKEY=\nROCKETRIDE_ANTHROPIC_KEY=   # falls back to ANTHROPIC_API_KEY",
      docs: { label: "docs.rocketride.org", href: "https://docs.rocketride.org" },
      extra: h?.llm.chain?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>chain:</span>
          {h.llm.chain.map((p, i) => (
            <React.Fragment key={p}>
              <Badge size="sm" tone={p === h.llm.active ? "accent" : "neutral"}>{providerName[p] ?? p}</Badge>
              {i < h.llm.chain.length - 1 && <span className="text-faint" aria-hidden>→</span>}
            </React.Fragment>
          ))}
        </div>
      ) : undefined,
    },
    {
      id: "cognee", name: "Cognee", icon: <Brain />, status: cognee,
      powers: "Persistent memory. After every run the findings are added to a knowledge graph (node_set = dataset + run tags) and recalled before the next plan, so investigations compound.",
      env: "ANTHROPIC_API_KEY=            # LLM for cognify\n# embeddings via ollama: `ollama pull nomic-embed-text`\nEMBEDDING_PROVIDER=ollama\nEMBEDDING_MODEL=nomic-embed-text:latest\nEMBEDDING_ENDPOINT=http://localhost:11434/api/embed\nEMBEDDING_DIMENSIONS=768\n# optional\nCOGNEE_BASE_URL=\nPARALLAX_MEMORY_MODE=auto",
      docs: { label: "docs.cognee.ai", href: "https://docs.cognee.ai" },
    },
    {
      id: "llm", name: "LLM", icon: <Cpu />, status: llm,
      powers: "The model behind every agent. Resolved per call down the chain rocketride → anthropic → ollama; the provider that served each call is tracked in run metrics.",
      env: "ANTHROPIC_API_KEY=\nANTHROPIC_MODEL=claude-sonnet-4-5\nOLLAMA_HOST=http://localhost:11434\nOLLAMA_MODEL=llama3.1:8b\nPARALLAX_LLM_MODE=auto        # auto | rocketride | anthropic | ollama",
      docs: { label: "docs.anthropic.com", href: "https://docs.anthropic.com" },
    },
  ];
}

const dotTone: Record<BadgeTone, string> = {
  success: "bg-success", warn: "bg-warn", danger: "bg-danger", neutral: "bg-faint", accent: "bg-accent", cyan: "bg-accent-2", info: "bg-info",
};

function ConnectionCard({ c, loading }: { c: Connection; loading: boolean }) {
  return (
    <Card padding="md" className="flex h-full flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-accent-2 [&_svg]:size-5" aria-hidden>{c.icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight text-text">{c.name}</h2>
          {loading ? (
            <Skeleton className="mt-1.5 h-4 w-40" />
          ) : (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className={cn("size-2 shrink-0 rounded-full", dotTone[c.status.tone], c.status.tone === "success" && "pulse-ring")} aria-hidden />
              <span className={cn(c.status.tone === "success" ? "text-text" : c.status.tone === "danger" ? "text-danger" : c.status.tone === "warn" ? "text-warn" : "text-muted")}>{c.status.label}</span>
            </div>
          )}
        </div>
        <a href={c.docs.href} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1 rounded text-xs text-muted hover:text-text">
          {c.docs.label} <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <p className="text-sm leading-relaxed text-muted">{c.powers}</p>
      {c.extra}
      <div className="relative mt-auto">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Environment</div>
        <pre className="codeblock pr-20">{c.env}</pre>
        <CopyButton text={c.env} label="Copy" className="absolute right-2 top-6 bg-surface-2/80 backdrop-blur" toastMessage={`${c.name} env vars copied`} />
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { health, loading, offline, refresh, updatedAt } = useHealth();
  const [refreshing, setRefreshing] = React.useState(false);
  const cards = connections(health, offline);

  const onRefresh = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Connections"
        description="Live status of each subsystem from /api/health. Configuration is read-only here — set the variables in .env and restart the backend. Secrets never touch the browser."
        actions={
          <>
            <Button icon={<RefreshCw />} loading={refreshing} onClick={() => void onRefresh()}>Re-check</Button>
            <CopyButton text={ENV_TEMPLATE} label="Copy .env template" copiedLabel="Template copied" variant="primary" size="md" toastMessage=".env template copied — paste into .env at the repo root" />
          </>
        }
      />

      {offline && (
        <div role="alert" className="mb-5 flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="size-2 shrink-0 rounded-full bg-danger pulse-ring" aria-hidden />
          <span className="text-text">Backend offline at <span className="mono">{API_URL}</span>.</span>
          <span className="text-muted">Start it with <code className="mono text-accent-2">make dev</code> from the repo root, then re-check.</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((c) => <ConnectionCard key={c.id} c={c} loading={loading && !health} />)}
      </div>

      <Card padding="md" className="mt-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-accent-2" aria-hidden><Server className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight text-text">Backend</h2>
            <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">API URL</dt>
                <dd className="mono mt-0.5 flex items-center gap-1 text-text"><span className="truncate">{API_URL}</span><CopyButton text={API_URL} iconOnly label="Copy API URL" toastMessage="API URL copied" /></dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">Version</dt>
                <dd className="mono mt-0.5 text-text">{loading && !health ? <Skeleton className="h-4 w-16" /> : health?.version ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">Status</dt>
                <dd className="mt-0.5">
                  {loading && !health ? <Skeleton className="h-4 w-20" /> : (
                    <Badge tone={health?.ok ? "success" : "danger"} dot pulse={!!health?.ok}>{health?.ok ? "healthy" : offline ? "offline" : "degraded"}</Badge>
                  )}
                  {updatedAt && <span className="ml-2 text-xs text-faint">checked {relativeTime(new Date(updatedAt).toISOString())}</span>}
                </dd>
              </div>
            </dl>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><FileKey className="size-3.5" aria-hidden /> Frontend reads <span className="mono">NEXT_PUBLIC_API_URL</span>; the backend reads <span className="mono">backend/.env</span> and the repo-root <span className="mono">.env</span>.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
