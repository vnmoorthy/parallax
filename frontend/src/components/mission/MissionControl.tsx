"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Bot, Brain, Cpu, Database, FileText, Home, ListTree, Network, RefreshCw, ScrollText, SquareTerminal, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Run } from "@/lib/types";
import { useRunStream, type StreamStatus } from "@/lib/api";
import { useRunStore } from "@/lib/store";
import { StatusStepper } from "./StatusStepper";
import { MetricsStrip } from "./MetricsStrip";
import { LineageTree } from "./LineageTree";
import { AgentGrid } from "./AgentGrid";
import { scrollToBranchCard } from "./AgentCard";
import { ReportView } from "./ReportView";
import { FindingsTable } from "./FindingsTable";
import { QueryLog } from "./QueryLog";
import { MemoryPanel } from "./MemoryPanel";
import { SqlConsole, ROOT_BRANCH } from "./SqlConsole";
import { PipelineGraph } from "./PipelineGraph";
import { BurstDialog } from "./BurstDialog";
import { ExportMenu } from "./ExportMenu";
import { BranchDetailDrawer } from "./BranchDetailDrawer";

export type MissionTab = "report" | "findings" | "queries" | "memory" | "sql" | "pipeline";
const TABS: { key: MissionTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "report", label: "Report", Icon: FileText },
  { key: "findings", label: "Findings", Icon: Table2 },
  { key: "queries", label: "Queries", Icon: ScrollText },
  { key: "memory", label: "Memory", Icon: Brain },
  { key: "sql", label: "SQL", Icon: SquareTerminal },
  { key: "pipeline", label: "Pipeline", Icon: Network },
];

const STREAM: Record<StreamStatus, { label: string; cls: string; ring?: boolean; pulse?: boolean }> = {
  idle:       { label: "idle",       cls: "bg-faint" },
  connecting: { label: "connecting", cls: "bg-warn", pulse: true },
  live:       { label: "live",       cls: "bg-accent-2", ring: true },
  done:       { label: "complete",   cls: "bg-success" },
  error:      { label: "stream error", cls: "bg-danger" },
};

function ModePill({ label, value, Icon }: { label: string; value: string; Icon: React.ComponentType<{ className?: string }> }) {
  const hot = value === "hotdata" || value === "rocketride" || value === "cognee";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", hot ? "border-success/40 bg-success/10 text-success" : "border-border bg-surface-2 text-muted")} title={`${label}: ${value}`}>
      <Icon className="size-3" /> <span className="text-faint">{label}</span> {value}
    </span>
  );
}

function StreamDot({ status }: { status: StreamStatus }) {
  const s = STREAM[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-muted" title={`SSE stream: ${s.label}`}>
      <span className={clsx("size-1.5 rounded-full", s.cls, s.ring && "pulse-ring", s.pulse && "animate-pulse")} />
      {s.label}
    </span>
  );
}

export function MissionSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4" aria-busy>
      <div className="space-y-3">
        <div className="skeleton h-7 w-2/3 max-w-xl" />
        <div className="flex gap-2"><div className="skeleton h-5 w-28" /><div className="skeleton h-5 w-20" /><div className="skeleton h-5 w-20" /><div className="skeleton h-5 w-20" /></div>
        <div className="skeleton h-7 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-9">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-[58px]" />)}</div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_450px]">
        <div className="skeleton h-[320px] xl:h-[640px]" />
        <div className="grid gap-3 @3xl:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-56" />)}</div>
        <div className="skeleton h-[420px] xl:h-[640px]" />
      </div>
    </div>
  );
}

function ErrorCard({ message, runId }: { message: string; runId: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center px-4">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card relative w-full overflow-hidden p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-danger via-warn to-transparent" />
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger/15 text-danger"><AlertTriangle className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-text">Couldn&apos;t load this run</h1>
            <p className="mono mt-1 break-words text-[12px] text-muted">run {runId}</p>
            <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{message}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => router.refresh()} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1.5 text-xs font-semibold text-white hover:brightness-110"><RefreshCw className="size-3.5" /> Retry</button>
              <Link href="/runs" className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-2 px-3.5 py-1.5 text-xs font-medium text-text hover:bg-surface-3"><ArrowLeft className="size-3.5" /> All runs</Link>
              <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:text-text"><Home className="size-3.5" /> Launch</Link>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function MissionControl({ runId }: { runId: string }) {
  const { run, events, status, error } = useRunStream(runId);
  const selectedBranch = useRunStore((s) => s.selectedBranch[runId] ?? null);
  const selectBranch = useRunStore((s) => s.selectBranch);
  const [tab, setTab] = useState<MissionTab>("report");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [burstOpen, setBurstOpen] = useState(false);
  const [sqlBranch, setSqlBranch] = useState<string>(ROOT_BRANCH);

  const select = useCallback((id: string | null) => selectBranch(runId, id), [runId, selectBranch]);
  const focusBranch = useCallback((id: string) => { select(id); scrollToBranchCard(id); }, [select]);
  const openDetail = useCallback((id: string) => { select(id); setDrawerOpen(true); }, [select]);
  const openSql = useCallback((id: string) => { setSqlBranch(id); setTab("sql"); setDrawerOpen(false); }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closeBurst = useCallback(() => setBurstOpen(false), []);

  useEffect(() => { if (typeof document !== "undefined" && run) document.title = `${run.question.slice(0, 60)} · Parallax`; }, [run]);

  const rightPanel = useMemo(() => {
    if (!run) return null;
    switch (tab) {
      case "report": return <ReportView run={run} onSelectBranch={focusBranch} />;
      case "findings": return <FindingsTable run={run} selectedBranch={selectedBranch} onSelect={focusBranch} />;
      case "queries": return <QueryLog run={run} events={events} onSelectBranch={focusBranch} />;
      case "memory": return <MemoryPanel run={run} events={events} />;
      case "sql": return <SqlConsole run={run} branchId={sqlBranch} onBranchChange={setSqlBranch} />;
      case "pipeline": return <PipelineGraph run={run} />;
    }
  }, [run, tab, selectedBranch, events, sqlBranch, focusBranch]);

  if (!run) {
    if (status === "error" && error) return <ErrorCard message={error} runId={runId} />;
    return <MissionSkeleton />;
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      {/* header */}
      <motion.header initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <Link href="/runs" className="inline-flex items-center gap-1 text-faint hover:text-text"><ArrowLeft className="size-3" /> runs</Link>
              <span className="text-faint">/</span>
              <span className="mono text-faint">{run.id.slice(0, 8)}</span>
            </div>
            <h1 className="text-balance text-xl font-semibold leading-tight tracking-tight text-text sm:text-2xl">{run.question}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text"><Database className="size-3 text-accent-2" /> {run.dataset_name}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text"><Bot className="size-3 text-accent" /> {run.agents} agents</span>
              <ModePill label="data" value={run.modes?.data ?? "local"} Icon={Database} />
              <ModePill label="llm" value={String(run.modes?.llm ?? "—")} Icon={Cpu} />
              <ModePill label="memory" value={run.modes?.memory ?? "local"} Icon={Brain} />
              <StreamDot status={status} />
              {error && run && <span className="text-[10px] text-danger" title={error}>reconnecting…</span>}
            </div>
          </div>
          <ExportMenu run={run} className="shrink-0" />
        </div>
        <StatusStepper status={run.status} error={run.error} />
      </motion.header>

      <MetricsStrip run={run} onBurst={() => setBurstOpen(true)} />

      {/* body */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_450px] xl:items-start">
        <section className="card flex flex-col overflow-hidden xl:sticky xl:top-[72px] xl:h-[calc(100vh-88px)]" aria-label="Lineage tree">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text"><ListTree className="size-3.5 text-accent-2" /> Lineage</div>
            <span className="text-[10px] text-faint">{run.branches.length} fork{run.branches.length === 1 ? "" : "s"} · click a node</span>
          </div>
          <div className="h-[320px] xl:h-auto xl:min-h-0 xl:flex-1">
            <LineageTree run={run} selectedBranch={selectedBranch} onSelect={openDetail} />
          </div>
        </section>

        <section className="min-w-0" aria-label="Agents">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text"><Bot className="size-3.5 text-accent" /> Agents <span className="text-faint font-normal">· {run.branches.filter((b) => b.status === "exploring").length} exploring · {run.branches.filter((b) => b.finding).length} findings</span></div>
            {selectedBranch && <button type="button" onClick={() => select(null)} className="text-[10px] text-faint hover:text-text">clear selection</button>}
          </div>
          <AgentGrid run={run} selectedBranch={selectedBranch} onSelect={(id) => select(id)} onOpenDetail={openDetail} />
        </section>

        <section className="card flex min-w-0 flex-col overflow-hidden xl:sticky xl:top-[72px] xl:h-[calc(100vh-88px)]" aria-label="Analysis panel">
          <div role="tablist" className="flex items-center gap-0 overflow-x-auto scrollbar-thin border-b border-border px-1 pt-1.5">
            {TABS.map((t) => {
              const active = tab === t.key;
              const badge = t.key === "findings" ? run.branches.filter((b) => b.finding).length : t.key === "report" && run.report ? 1 : 0;
              return (
                <button
                  key={t.key} role="tab" aria-selected={active} type="button" onClick={() => setTab(t.key)}
                  className={clsx("relative inline-flex shrink-0 items-center gap-1 rounded-t-lg px-1.5 py-2 text-[11px] font-medium transition-colors", active ? "text-text" : "text-muted hover:text-text")}
                >
                  <t.Icon className={clsx("size-3.5", active && "text-accent-2")} /> {t.label}
                  {badge > 0 && t.key === "findings" && <span className="mono rounded-full bg-success/15 px-1.5 text-[9px] text-success">{badge}</span>}
                  {t.key === "report" && run.report && !active && <span className="size-1.5 rounded-full bg-accent-2" />}
                  {active && <motion.span layoutId="mc-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-accent to-accent-2" />}
                </button>
              );
            })}
          </div>
          <div className="min-h-[480px] flex-1 overflow-y-auto scrollbar-thin p-3.5 xl:min-h-0">
            <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="h-full min-h-0">
              {rightPanel}
            </motion.div>
          </div>
        </section>
      </div>

      <BurstDialog open={burstOpen} runId={run.id} initial={run.metrics?.burst ?? null} onClose={closeBurst} />
      <BranchDetailDrawer run={run} branchId={selectedBranch} open={drawerOpen} onClose={closeDrawer} onOpenSql={openSql} />
    </div>
  );
}

export type { Run };
