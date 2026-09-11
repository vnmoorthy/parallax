"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, FileText, GitFork, Loader2, Quote, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { Run } from "@/lib/types";
import { api } from "@/lib/api";
import { shortId } from "@/lib/layout";
import { ConfidenceBar } from "./ConfidenceBar";

const BRANCH_TOKEN = /\[branch:([A-Za-z0-9_\-.:]+)\]/g;
const BRANCH_HREF = "#branch=";

/** Rewrites `[branch:ID]` citation tokens into markdown links we can intercept in the renderer. */
export function linkifyCitations(md: string): string {
  return md.replace(BRANCH_TOKEN, (_, id: string) => `[${id}](${BRANCH_HREF}${encodeURIComponent(id)})`);
}

export function BranchChip({ id, title, onClick, className }: { id: string; title?: string; onClick?: (id: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick?.(id); }}
      className={clsx("mono inline-flex max-w-full items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-[1px] align-baseline text-[10px] font-medium text-accent-2 hover:bg-accent/20 hover:border-accent transition-colors", className)}
      title={title ? `${title}\n(${id})` : id}
    >
      <GitFork className="size-2.5" />
      <span className="truncate">{title ? (title.length > 28 ? title.slice(0, 27) + "…" : title) : shortId(id, 8)}</span>
    </button>
  );
}

function useMarkdownComponents(run: Run, onSelectBranch: (id: string) => void): Components {
  return useMemo<Components>(() => {
    const titleOf = (id: string) => {
      const b = run.branches.find((x) => x.id === id || shortId(x.id, 8) === id || x.hypothesis_id === id);
      const h = b ? run.plan.find((x) => x.id === b.hypothesis_id) : run.plan.find((x) => x.id === id);
      return { branchId: b?.id ?? id, title: h?.title };
    };
    return {
      a: ({ href, children }) => {
        if (href && href.startsWith(BRANCH_HREF)) {
          const raw = decodeURIComponent(href.slice(BRANCH_HREF.length));
          const { branchId, title } = titleOf(raw);
          return <BranchChip id={branchId} title={title} onClick={onSelectBranch} className="mx-0.5" />;
        }
        return <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-2 underline decoration-accent-2/40 underline-offset-2 hover:decoration-accent-2">{children}</a>;
      },
      h1: ({ children }) => <h1 className="mt-4 mb-2 text-lg font-semibold text-text first:mt-0">{children}</h1>,
      h2: ({ children }) => <h2 className="mt-4 mb-1.5 text-[15px] font-semibold text-text first:mt-0">{children}</h2>,
      h3: ({ children }) => <h3 className="mt-3 mb-1 text-[13px] font-semibold text-text">{children}</h3>,
      h4: ({ children }) => <h4 className="mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</h4>,
      p: ({ children }) => <p className="my-2 text-[13px] leading-relaxed text-text/90">{children}</p>,
      ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-text/90 marker:text-faint">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-text/90 marker:text-faint">{children}</ol>,
      li: ({ children }) => <li className="pl-0.5">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
      em: ({ children }) => <em className="italic text-muted">{children}</em>,
      blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-accent/60 bg-accent/5 px-3 py-1 text-[13px] text-muted">{children}</blockquote>,
      hr: () => <hr className="my-4 border-border" />,
      code: ({ children, className }) => {
        const block = !!className;
        return block
          ? <code className={clsx("mono text-[11px]", className)}>{children}</code>
          : <code className="mono rounded bg-surface-3 px-1 py-[1px] text-[11px] text-accent-2">{children}</code>;
      },
      pre: ({ children }) => <pre className="mono my-2 overflow-x-auto scrollbar-thin rounded-lg border border-border bg-bg-elev/70 p-3 text-[11px] leading-relaxed text-text/90">{children}</pre>,
      table: ({ children }) => <div className="my-2 overflow-x-auto scrollbar-thin rounded-lg border border-border"><table className="w-full border-collapse text-[12px]">{children}</table></div>,
      thead: ({ children }) => <thead className="bg-surface-2/70">{children}</thead>,
      th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left font-semibold text-muted">{children}</th>,
      td: ({ children }) => <td className="border-b border-border/60 px-2 py-1 align-top text-text/90">{children}</td>,
    };
  }, [run, onSelectBranch]);
}

export function ReportView({ run, onSelectBranch, className }: { run: Run; onSelectBranch: (id: string) => void; className?: string }) {
  const router = useRouter();
  const [launching, setLaunching] = useState<string | null>(null);
  const components = useMarkdownComponents(run, onSelectBranch);
  const report = run.report;
  const md = useMemo(() => (report ? linkifyCitations(report.markdown || "") : ""), [report]);

  const ask = async (question: string) => {
    if (launching) return;
    setLaunching(question);
    try {
      const { run_id } = await api.createRun({ dataset_id: run.dataset_id, question, agents: run.agents });
      toast.success("New swarm launched");
      router.push(`/runs/${run_id}`);
    } catch (e) { toast.error((e as Error).message); setLaunching(null); }
  };

  if (!report) {
    const early = run.status === "queued" || run.status === "provisioning" || run.status === "planning";
    const failed = run.status === "failed";
    return (
      <div className={clsx("flex h-full flex-col", className)}>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <div className="relative grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-accent/25 to-accent-2/15">
            {failed ? <FileText className="size-5 text-danger" /> : <Sparkles className={clsx("size-5 text-accent-2", !failed && "animate-pulse")} />}
            {!failed && <span className="absolute inset-0 rounded-2xl pulse-ring" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-text">{failed ? "No report — run failed" : run.status === "synthesizing" ? "Synthesizing…" : early ? "Report will appear after synthesis" : "Agents still exploring"}</div>
            <div className="mt-1 text-[11px] text-muted">
              {failed ? "Fix the error above and re-run." : `${run.branches.filter((b) => b.finding).length}/${run.branches.length || run.agents} findings in · the synthesizer cites branches as [branch:id] chips.`}
            </div>
          </div>
          {!failed && (
            <div className="mt-2 w-full max-w-sm space-y-2">
              <div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-11/12" /><div className="skeleton h-3 w-4/5" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx("space-y-4", className)}>
      <header>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint"><FileText className="size-3" /> Synthesized report</div>
        <h2 className="mt-1 text-lg font-semibold leading-snug text-text">{report.title}</h2>
      </header>

      {report.executive_summary && (
        <div className="relative overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-surface-2 to-accent-2/5 p-4">
          <Quote className="absolute -right-2 -top-2 size-14 text-accent/10" />
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent-2">Executive summary</div>
          <p className="text-[13px] leading-relaxed text-text">{report.executive_summary}</p>
        </div>
      )}

      <article className="max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{md}</ReactMarkdown>
      </article>

      {report.key_findings?.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Key findings</div>
          <ol className="space-y-2">
            {report.key_findings.map((f, i) => {
              const b = run.branches.find((x) => x.id === f.branch_id);
              const h = b ? run.plan.find((x) => x.id === b.hypothesis_id) : undefined;
              return (
                <li key={i} className="card-2 flex gap-3 p-3 hover:border-border-strong transition-colors cursor-pointer" onClick={() => f.branch_id && onSelectBranch(f.branch_id)}>
                  <span className="mono mt-0.5 text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-[13px] leading-relaxed text-text">{f.claim}</p>
                    <div className="flex items-center gap-3">
                      <ConfidenceBar value={f.confidence} className="max-w-[200px]" />
                      {f.branch_id && <BranchChip id={f.branch_id} title={h?.title} onClick={onSelectBranch} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {report.next_questions?.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Next questions · click to launch a new swarm</div>
          <div className="flex flex-wrap gap-1.5">
            {report.next_questions.map((q) => (
              <button
                key={q} type="button" onClick={() => void ask(q)} disabled={!!launching}
                className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-left text-[12px] text-text hover:border-accent/60 hover:bg-accent/10 disabled:opacity-60 transition-colors"
              >
                {launching === q ? <Loader2 className="size-3 shrink-0 animate-spin text-accent-2" /> : <ArrowRight className="size-3 shrink-0 text-accent-2 transition-transform group-hover:translate-x-0.5" />}
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {report.citations?.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Citations</div>
          <div className="flex flex-wrap gap-1.5">
            {report.citations.map((c, i) => <BranchChip key={`${c.branch_id}-${i}`} id={c.branch_id} title={c.hypothesis} onClick={onSelectBranch} />)}
          </div>
        </section>
      )}
    </div>
  );
}
