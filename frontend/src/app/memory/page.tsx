"use client";
import * as React from "react";
import { AlertTriangle, Brain, Database, ExternalLink, Hash, Network, RefreshCw, Search, Tags } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { MemoryHit } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { formatNumber, formatPct, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Progress } from "@/components/ui/Progress";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { CopyButton } from "@/components/ui/CopyButton";

type MemoryInfo = { kind: string; stats: Record<string, number | string>; recent: MemoryHit[] };

const COGNEE_ENV = `# Cognee needs BOTH an LLM and an embedding provider
PARALLAX_MEMORY_MODE=cognee
ANTHROPIC_API_KEY=sk-ant-...            # LLM used by cognify (or LLM_PROVIDER=ollama for fully local)
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5
EMBEDDING_PROVIDER=ollama                # ollama pull nomic-embed-text
EMBEDDING_MODEL=nomic-embed-text:latest
EMBEDDING_ENDPOINT=http://localhost:11434/api/embed
EMBEDDING_DIMENSIONS=768
# COGNEE_BASE_URL=http://localhost:8765  # optional remote Cognee server`;

function scoreTone(score: number): "success" | "accent" | "warn" {
  if (score >= 0.75) return "success";
  if (score >= 0.45) return "accent";
  return "warn";
}

function MemoryHitRow({ hit, showScore }: { hit: MemoryHit; showScore?: boolean }) {
  const score = Math.max(0, Math.min(1, hit.score ?? 0));
  return (
    <li className="card-2 p-4">
      <p className="text-sm leading-relaxed text-text">{hit.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {showScore && (
          <div className="flex min-w-[160px] items-center gap-2" aria-label={`Relevance ${formatPct(score)}`}>
            <Progress value={score * 100} size="xs" tone={scoreTone(score)} className="w-24" label="Relevance" />
            <span className="tabular text-xs text-muted">{formatPct(score)}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {hit.tags.map((t) => (
            <Badge key={t} size="sm" tone={t.startsWith("run:") ? "neutral" : "accent"} mono>{t}</Badge>
          ))}
        </div>
        {hit.created_at && <span className="ml-auto text-xs text-faint" title={hit.created_at}>{relativeTime(hit.created_at)}</span>}
      </div>
    </li>
  );
}

export default function MemoryPage() {
  const [info, setInfo] = React.useState<MemoryInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<MemoryHit[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [lastQuery, setLastQuery] = React.useState<string | null>(null);

  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    api.memory()
      .then((m) => { if (cancelled) return; setInfo(m); setError(null); })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = errorMessage(e);
        setError(msg);
        toast.error("Couldn't load memory", { description: msg });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const reload = () => { setLoading(true); setAttempt((a) => a + 1); };

  const recall = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    try {
      const res = await api.recall(query);
      setHits(res);
      setLastQuery(query);
      if (res.length === 0) toast.message("Nothing recalled", { description: "No memories matched that query yet." });
    } catch (err) {
      toast.error("Recall failed", { description: errorMessage(err) });
    } finally {
      setSearching(false);
    }
  };

  const stats = info?.stats ?? {};
  const count = Number(stats.count ?? stats.memories ?? stats.total ?? info?.recent.length ?? 0);
  const tagCount = Number(stats.tags ?? stats.tag_count ?? 0);
  const extraStats = Object.entries(stats).filter(([k, v]) => !["count", "memories", "total", "tags", "tag_count", "kind"].includes(k) && typeof v === "number").slice(0, 2);
  const isCognee = info?.kind === "cognee";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Persistent context"
        title="Memory"
        description="What Parallax remembers across runs — recalled before every plan so the next investigation starts smarter."
        actions={
          <>
            {info && <Badge tone={isCognee ? "success" : "neutral"} dot>{isCognee ? "Cognee knowledge graph" : "Local memory"}</Badge>}
            <Button icon={<RefreshCw />} onClick={reload} loading={loading && !!info}>Refresh</Button>
          </>
        }
      />

      {/* Recall */}
      <Card padding="md">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => void recall(e)} role="search" aria-label="Recall memories">
          <Input
            icon={<Search />}
            inputSize="lg"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask memory… e.g. churn drivers for SaaS customers"
            aria-label="Recall query"
          />
          <Button type="submit" variant="primary" size="lg" icon={<Brain />} loading={searching} disabled={!q.trim()} className="sm:min-w-[140px]">
            Recall
          </Button>
        </form>
        {hits !== null && (
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">
                {hits.length > 0 ? `${formatNumber(hits.length)} recalled for “${lastQuery}”` : `Nothing recalled for “${lastQuery}”`}
              </h2>
              <Button size="sm" variant="ghost" onClick={() => { setHits(null); setLastQuery(null); }}>Clear</Button>
            </div>
            {hits.length > 0 ? (
              <ul className="space-y-2">{hits.map((h, i) => <MemoryHitRow key={`${i}-${h.text.slice(0, 24)}`} hit={h} showScore />)}</ul>
            ) : (
              <EmptyState compact icon={<Brain />} title="No matching memories" description="Run a few investigations on this dataset and the swarm will remember what it learned." />
            )}
          </div>
        )}
      </Card>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Memories" value={formatNumber(count)} hint="findings remembered so far" icon={<Hash />} tone="accent" loading={loading && !info} />
        <StatTile label="Tags" value={formatNumber(tagCount)} hint="datasets and runs indexed" icon={<Tags />} tone="cyan" loading={loading && !info} />
        <StatTile label="Backend" value={isCognee ? "Cognee" : info ? "Local" : "—"} hint={isCognee ? "graph + vector recall" : "JSON + embeddings fallback"} icon={<Database />} tone={isCognee ? "success" : "neutral"} loading={loading && !info} />
        {extraStats.map(([k, v]) => (
          <StatTile key={k} label={k.replace(/_/g, " ")} value={formatNumber(Number(v))} tone="neutral" />
        ))}
      </div>

      {/* Recent */}
      <section aria-labelledby="recent-memories">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-memories" className="text-lg font-semibold tracking-tight text-text">Recent memories</h2>
          {info && <span className="tabular text-xs text-faint">{formatNumber(info.recent.length)} shown</span>}
        </div>
        {error && !info ? (
          <EmptyState tone="danger" icon={<AlertTriangle />} title="Couldn't load memory" description={error} action={<Button icon={<RefreshCw />} onClick={reload}>Retry</Button>} />
        ) : loading && !info ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="card-2 p-4"><SkeletonText lines={2} /><div className="mt-3 flex gap-2"><Skeleton className="h-5 w-24 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div></li>
            ))}
          </ul>
        ) : info && info.recent.length > 0 ? (
          <ul className="space-y-2">{info.recent.map((h, i) => <MemoryHitRow key={`${i}-${h.text.slice(0, 24)}`} hit={h} />)}</ul>
        ) : (
          <EmptyState icon={<Brain />} title="Memory is empty" description="Every completed run writes its findings here, tagged by dataset and run id." />
        )}
      </section>

      {/* Graph */}
      <section aria-labelledby="graph">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="graph" className="text-lg font-semibold tracking-tight text-text">Knowledge graph</h2>
          {isCognee && (
            <a href={api.memoryGraphUrl()} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
              Open in new tab <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
        {loading && !info ? (
          <Skeleton className="h-[600px] w-full rounded-xl" />
        ) : isCognee ? (
          <iframe
            src={api.memoryGraphUrl()}
            title="Cognee knowledge graph"
            loading="lazy"
            className="h-[600px] w-full rounded-xl border bg-bg"
          />
        ) : (
          <Card padding="lg">
            <CardHeader className="mb-3">
              <div className="flex items-center gap-2">
                <Network className="size-5 text-accent-2" aria-hidden />
                <CardTitle>Cognee memory is not active</CardTitle>
              </div>
              <CardDescription>
                Parallax is using the local JSON + embeddings fallback, so there’s no graph to render. Cognee builds a persistent knowledge graph from every
                run’s findings and needs both an LLM and an embedding provider. Add these to <span className="mono text-text">.env</span> and restart the backend.
              </CardDescription>
            </CardHeader>
            <div className="relative">
              <pre className="codeblock">{COGNEE_ENV}</pre>
              <CopyButton text={COGNEE_ENV} label="Copy" className="absolute right-2 top-2 bg-surface-2/80 backdrop-blur" />
            </div>
            <p className="mt-3 text-xs text-muted">
              Fully local alternative: <span className="mono text-text">LLM_PROVIDER=ollama</span> with <span className="mono text-text">LLM_MODEL=llama3.1:8b</span> — no API key required.
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}
