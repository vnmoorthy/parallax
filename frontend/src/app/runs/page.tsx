"use client";
import * as React from "react";
import { AlertTriangle, ArrowUpRight, History, RefreshCw, Rocket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { RunSummary } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { formatMs, formatNumber, relativeTime, truncate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Badge, isActiveStatus, statusTone } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/Table";
import { Dialog } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";

const REFRESH_MS = 10_000;

function modeLabel(kind: string, value: string): string {
  if (kind === "data") return value === "hotdata" ? "Hotdata" : "DuckDB";
  if (kind === "memory") return value === "cognee" ? "Cognee" : "local mem";
  switch (value) {
    case "rocketride": return "RocketRide";
    case "anthropic": return "Anthropic";
    case "ollama": return "Ollama";
    case "fake": return "Fake LLM";
    default: return value || "—";
  }
}

export default function RunsPage() {
  const [runs, setRuns] = React.useState<RunSummary[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<RunSummary | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);

  const [attempt, setAttempt] = React.useState(0);

  const applyRuns = React.useCallback((r: RunSummary[]) => {
    setRuns(r);
    setError(null);
    setLastUpdated(Date.now());
  }, []);
  const applyFailure = React.useCallback((e: unknown, silent: boolean) => {
    const msg = errorMessage(e);
    setError(msg);
    if (!silent) toast.error("Couldn't load runs", { description: msg });
  }, []);

  // Background refresh used by the timer, the visibility listener and the Refresh button.
  const refetch = React.useCallback((silent: boolean) => {
    api.runs().then(applyRuns).catch((e: unknown) => applyFailure(e, silent)).finally(() => setRefreshing(false));
  }, [applyRuns, applyFailure]);

  React.useEffect(() => {
    let cancelled = false;
    api.runs()
      .then((r) => { if (!cancelled) applyRuns(r); })
      .catch((e: unknown) => { if (!cancelled) applyFailure(e, false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const tick = () => { if (document.visibilityState === "visible") refetch(true); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [attempt, applyRuns, applyFailure, refetch]);

  const refresh = () => { setRefreshing(true); refetch(true); };
  const retry = () => { setLoading(true); setError(null); setAttempt((a) => a + 1); };

  const remove = async () => {
    const target = confirm;
    if (!target) return;
    setConfirm(null);
    setRuns((prev) => prev?.filter((r) => r.id !== target.id) ?? prev);
    try {
      await api.deleteRun(target.id);
      toast.success("Run deleted", { description: truncate(target.question, 60) });
    } catch (e) {
      setRuns((prev) => (prev ? [...prev, target].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) : prev));
      toast.error("Couldn't delete run", { description: errorMessage(e) });
    }
  };

  const columns: Column<RunSummary>[] = [
    {
      key: "status", header: "Status", width: 120,
      render: (r) => (
        <Badge tone={statusTone(r.status)} dot pulse={isActiveStatus(r.status)} size="sm">{r.status}</Badge>
      ),
    },
    { key: "dataset", header: "Dataset", render: (r) => <span className="mono text-[13px] text-text">{r.dataset_name}</span> },
    {
      key: "question", header: "Question", className: "max-w-[420px]",
      render: (r) => (
        <span className="block truncate text-text" title={r.question}>{truncate(r.question, 80)}</span>
      ),
    },
    { key: "agents", header: "Agents", align: "right", mono: true, render: (r) => formatNumber(r.agents) },
    { key: "queries", header: "Queries", align: "right", mono: true, render: (r) => formatNumber(r.queries) },
    { key: "elapsed", header: "Elapsed", align: "right", mono: true, render: (r) => formatMs(r.elapsed_ms) },
    { key: "p50", header: "p50", align: "right", mono: true, render: (r) => formatMs(r.p50_ms) },
    {
      key: "modes", header: "Modes", className: "hidden xl:table-cell", headerClassName: "hidden xl:table-cell",
      render: (r) => (
        <span className="flex items-center gap-1">
          <Badge size="sm" tone={r.modes?.data === "hotdata" ? "cyan" : "neutral"}>{modeLabel("data", r.modes?.data ?? "")}</Badge>
          <Badge size="sm" tone={r.modes?.llm === "rocketride" ? "accent" : r.modes?.llm === "fake" ? "warn" : "neutral"}>{modeLabel("llm", String(r.modes?.llm ?? ""))}</Badge>
          <Badge size="sm" tone={r.modes?.memory === "cognee" ? "success" : "neutral"}>{modeLabel("memory", r.modes?.memory ?? "")}</Badge>
        </span>
      ),
    },
    {
      key: "created", header: "Started", className: "hidden md:table-cell", headerClassName: "hidden md:table-cell",
      render: (r) => <span className="text-muted" title={r.created_at}>{relativeTime(r.created_at)}</span>,
    },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, align: "right",
      render: (r) => (
        <span className="flex items-center justify-end gap-1">
          <LinkButton href={`/runs/${r.id}`} size="sm" iconRight={<ArrowUpRight />} aria-label={`Open run ${r.id}`}>Open</LinkButton>
          <Tooltip content="Delete run and its databases" side="left">
            <Button size="icon-sm" variant="ghost" aria-label={`Delete run ${r.id}`} onClick={() => setConfirm(r)} className="text-faint hover:text-danger">
              <Trash2 />
            </Button>
          </Tooltip>
        </span>
      ),
    },
  ];

  const empty = !loading && !error && runs && runs.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="History"
        title="Runs"
        description="Every swarm you've launched, newest first. Refreshes every 10 seconds while this tab is visible."
        actions={
          <>
            {lastUpdated && <span className="hidden text-xs text-faint sm:inline" aria-live="polite">updated {relativeTime(new Date(lastUpdated).toISOString())}</span>}
            <Button icon={<RefreshCw />} loading={refreshing} onClick={refresh}>Refresh</Button>
            <LinkButton href="/" variant="primary" icon={<Rocket />}>New run</LinkButton>
          </>
        }
      />

      {error && !runs ? (
        <EmptyState
          tone="danger"
          icon={<AlertTriangle />}
          title="Couldn't load runs"
          description={error}
          action={<Button icon={<RefreshCw />} onClick={retry}>Retry</Button>}
        />
      ) : empty ? (
        <EmptyState
          icon={<History />}
          title="No runs yet"
          description="Launch your first swarm: pick a dataset, ask a question, and watch the agents fork and explore."
          action={<LinkButton href="/" variant="primary" icon={<Rocket />}>Launch a run</LinkButton>}
        />
      ) : (
        <>
          {error && (
            <div role="status" className="mb-3 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
              <AlertTriangle className="size-3.5" aria-hidden /> Showing cached list — last refresh failed: {error}
            </div>
          )}
          <DataTable
            columns={columns}
            rows={runs ?? []}
            rowKey={(r) => r.id}
            loading={loading && !runs}
            loadingRows={6}
            caption="Run history"
            emptyMessage="No runs"
          />
          {runs && runs.length > 0 && (
            <p className="tabular mt-3 text-xs text-faint">{formatNumber(runs.length)} run{runs.length === 1 ? "" : "s"}</p>
          )}
        </>
      )}

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title="Delete this run?"
        description="This removes the run, its report, and every forked database. It can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} data-autofocus>Cancel</Button>
            <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>Delete run</Button>
          </>
        }
      >
        {confirm && (
          <div className="card-2 p-3 text-sm">
            <div className="text-text">{truncate(confirm.question, 140)}</div>
            <div className="mono mt-1 text-xs text-faint">{confirm.dataset_name} · {confirm.agents} agents · {relativeTime(confirm.created_at)}</div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
