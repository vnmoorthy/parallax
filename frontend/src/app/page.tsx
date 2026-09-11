"use client";
import * as React from "react";
import { AlertTriangle, Brain, GitFork, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Dataset } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/StatTile";
import { DatasetCard } from "@/components/DatasetCard";
import { DatasetPreviewDrawer } from "@/components/DatasetPreviewDrawer";
import { UploadDropzone } from "@/components/UploadDropzone";
import { LaunchForm } from "@/components/LaunchForm";


function SectionHeading({ index, title, description, right }: { index: string; title: string; description?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-text sm:text-xl">
          <span className="mono text-sm text-accent-2">{index}</span>
          <span className="text-faint" aria-hidden>·</span>
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {right}
    </div>
  );
}

function DatasetSkeleton() {
  return (
    <div className="card flex h-full flex-col gap-3 p-5" aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex gap-2"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div>
      <div className="mt-auto border-t pt-3"><Skeleton className="h-7 w-24" /></div>
    </div>
  );
}

export default function LaunchPage() {
  const [datasets, setDatasets] = React.useState<Dataset[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [previewDs, setPreviewDs] = React.useState<Dataset | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    api.datasets()
      .then((ds) => {
        if (cancelled) return;
        setDatasets(ds);
        setError(null);
        setSelectedId((cur) => (cur && ds.some((d) => d.id === cur) ? cur : ds[0]?.id ?? null));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = errorMessage(e);
        setError(msg);
        toast.error("Couldn't load datasets", { description: msg });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = () => { setLoading(true); setError(null); setAttempt((a) => a + 1); };

  const selected = React.useMemo(() => datasets?.find((d) => d.id === selectedId) ?? null, [datasets, selectedId]);

  const onUploaded = (d: Dataset) => {
    setDatasets((prev) => [d, ...(prev ?? []).filter((x) => x.id !== d.id)]);
    setSelectedId(d.id);
  };

  const openPreview = (d: Dataset) => { setPreviewDs(d); setPreviewOpen(true); };
  const closePreview = React.useCallback(() => setPreviewOpen(false), []);

  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="reveal reveal-1 relative overflow-hidden pt-6 sm:pt-10" aria-labelledby="hero-title">
        <div className="grid-fade pointer-events-none absolute inset-x-0 -top-10 h-[420px]" aria-hidden />
        <div className="float pointer-events-none absolute -left-24 top-0 size-72 rounded-full bg-accent/20 blur-[100px]" aria-hidden />
        <div className="float pointer-events-none absolute right-0 top-10 size-64 rounded-full bg-accent-2/15 blur-[100px] [animation-delay:-3s]" aria-hidden />
        <div className="relative mx-auto max-w-3xl text-center">
          <Badge tone="accent" dot className="mb-5">Multi-agent data analysis</Badge>
          <h1 id="hero-title" className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-text sm:text-5xl lg:text-6xl">
            <span className="gradient-text">Many agents. Many branches.</span>
            <br />
            One answer.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Parallax forks an isolated database per hypothesis, lets analyst agents explore concurrently with SQL, keyword and vector
            search, then synthesizes a cited report and remembers what it learned.
          </p>
        </div>
        <div className="relative mx-auto mt-9 grid max-w-4xl gap-3 sm:grid-cols-3">
          <StatTile label="Concurrent analyst agents" value="2–16" hint="one hypothesis each, explored in parallel" icon={<Users />} tone="accent" />
          <StatTile label="Isolated database forks" value="1 per hypothesis" hint="copy-on-write branches of your data" icon={<GitFork />} tone="cyan" />
          <StatTile label="Memory" value="persists across runs" hint="recalled before every plan" icon={<Brain />} tone="success" />
        </div>
      </section>

      {/* 1 · Dataset */}
      <section className="reveal reveal-2" aria-labelledby="choose-dataset">
        <SectionHeading
          index="1"
          title="Choose a dataset"
          description="Bundled samples ship with free-text columns for keyword + vector search, or bring your own CSV."
          right={datasets && !loading ? (
            <span className="tabular text-xs text-faint">{datasets.length} available</span>
          ) : null}
        />
        {error && !loading ? (
          <div role="alert" className="card flex flex-col items-start gap-3 border-danger/30 bg-danger/5 p-5 sm:flex-row sm:items-center">
            <AlertTriangle className="size-5 shrink-0 text-danger" aria-hidden />
            <div className="flex-1">
              <div className="text-sm font-medium text-text">Couldn’t load datasets</div>
              <div className="mt-0.5 text-xs text-muted">{error}</div>
            </div>
            <Button icon={<RefreshCw />} onClick={retry}>Retry</Button>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Datasets" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading && !datasets
              ? Array.from({ length: 3 }).map((_, i) => <DatasetSkeleton key={i} />)
              : (datasets ?? []).map((d) => (
                <DatasetCard key={d.id} dataset={d} selected={d.id === selectedId} onSelect={(ds) => setSelectedId(ds.id)} onPreview={openPreview} />
              ))}
            <UploadDropzone onUploaded={onUploaded} />
          </div>
        )}
      </section>

      {/* 2 · Question */}
      <section className="reveal reveal-3" aria-labelledby="ask-question">
        <SectionHeading index="2" title="Ask a question" description="The planner turns it into N diverse hypotheses; each agent gets its own forked database." />
        <LaunchForm dataset={selected} />
      </section>

      <DatasetPreviewDrawer
        dataset={previewDs}
        open={previewOpen}
        onClose={closePreview}
        selected={!!previewDs && previewDs.id === selectedId}
        onSelect={(d) => { setSelectedId(d.id); setPreviewOpen(false); toast.success(`Selected ${d.name}`); }}
      />
    </div>
  );
}
