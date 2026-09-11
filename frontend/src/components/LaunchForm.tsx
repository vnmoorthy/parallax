"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Rocket, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Dataset } from "@/lib/types";
import { cn, errorMessage } from "@/lib/utils";
import { useIsMac } from "@/lib/hooks";
import { Button } from "./ui/Button";
import { Hint, Label } from "./ui/Input";
import { Textarea } from "./ui/Textarea";
import { Slider } from "./ui/Slider";
import { Select } from "./ui/Select";
import { Kbd } from "./ui/Kbd";

const MIN_AGENTS = 2;
const MAX_AGENTS = 16;
const DEFAULT_AGENTS = 6;

export interface LaunchFormProps {
  dataset: Dataset | null;
  className?: string;
}

export function LaunchForm({ dataset, className }: LaunchFormProps) {
  const router = useRouter();
  const [question, setQuestion] = React.useState("");
  const [agents, setAgents] = React.useState(DEFAULT_AGENTS);
  const [submitting, setSubmitting] = React.useState(false);
  const mac = useIsMac();
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const datasetId = dataset?.id ?? null;
  const firstTextColumn = dataset?.text_columns[0] ?? "";
  // Per-dataset state is keyed by dataset id, so switching datasets resets it without an effect.
  const [pickedColumn, setPickedColumn] = React.useState<{ id: string | null; value: string } | null>(null);
  const [failure, setFailure] = React.useState<{ id: string | null; message: string } | null>(null);
  const searchColumn = pickedColumn && pickedColumn.id === datasetId ? pickedColumn.value : firstTextColumn;
  const error = failure && failure.id === datasetId ? failure.message : null;
  const setSearchColumn = (value: string) => setPickedColumn({ id: datasetId, value });
  const setError = (message: string | null) => setFailure(message ? { id: datasetId, message } : null);

  const trimmed = question.trim();
  const canLaunch = !!dataset && trimmed.length >= 3 && !submitting;

  const submit = async () => {
    if (!dataset || !canLaunch) return;
    setSubmitting(true);
    setError(null);
    try {
      const { run_id } = await api.createRun({
        dataset_id: dataset.id,
        question: trimmed,
        agents,
        search_column: searchColumn || undefined,
      });
      toast.success("Swarm launched", { description: `${agents} analyst agents are forking ${dataset.name}.` });
      router.push(`/runs/${run_id}`);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("Couldn't launch the run", { description: msg });
      setSubmitting(false);
    }
  };

  const applySuggestion = (q: string) => {
    setQuestion(q);
    textareaRef.current?.focus();
  };

  const summary = dataset
    ? `${agents} agents will fork ${dataset.name} into ${agents} isolated databases${searchColumn ? `, index “${searchColumn}” for keyword + vector search` : ""}, explore in parallel, then synthesize one cited report.`
    : "Choose a dataset above to configure the swarm.";

  return (
    <form
      className={cn("card space-y-6 p-5 sm:p-6", className)}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      aria-describedby="launch-summary"
    >
      <div>
        <Label htmlFor="question" hint={dataset ? <span>on <span className="mono text-text">{dataset.name}</span></span> : undefined}>
          Question
        </Label>
        <Textarea
          id="question"
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
          placeholder={dataset?.suggested_questions[0] ?? "e.g. Why are customers churning and where is revenue at risk?"}
          rows={3}
          autoResize
          maxLength={600}
          invalid={!!error}
          className="text-[15px]"
          aria-describedby="question-hint"
        />
        <div id="question-hint" className="mt-2.5">
          {dataset ? (
            dataset.suggested_questions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-faint"><Sparkles className="size-3.5 text-accent-2" aria-hidden /> Try</span>
                {dataset.suggested_questions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => applySuggestion(q)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-left text-xs outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-accent-2/80",
                      q === question ? "border-accent/60 bg-accent/15 text-text" : "border-border-strong bg-surface-2 text-muted hover:border-white/20 hover:text-text",
                    )}
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : (
              <Hint>Ask anything a data analyst could answer with SQL and search over this dataset.</Hint>
            )
          ) : (
            <Hint>Pick a dataset to see suggested questions.</Hint>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Slider
          id="agents"
          label="Analyst agents"
          value={agents}
          onChange={setAgents}
          min={MIN_AGENTS}
          max={MAX_AGENTS}
          step={1}
          formatValue={(v) => `${v} agents`}
          hint={<span><span className="tabular text-text">{agents}</span> agents → <span className="tabular text-text">{agents}</span> forked databases, one hypothesis each</span>}
        />
        <div>
          <Label htmlFor="search-column" optional hint={dataset && dataset.text_columns.length === 0 ? "no text columns" : undefined}>
            Search column
          </Label>
          <Select
            id="search-column"
            value={searchColumn}
            onChange={(e) => setSearchColumn(e.target.value)}
            disabled={!dataset || dataset.text_columns.length === 0}
            options={[
              { value: "", label: dataset && dataset.text_columns.length > 0 ? "None — SQL only" : "No free-text column" },
              ...(dataset?.text_columns ?? []).map((c) => ({ value: c, label: c })),
            ]}
          />
          <Hint>Gets a BM25 keyword index and a vector index so agents can search, not just aggregate.</Hint>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p id="launch-summary" className="max-w-xl text-sm leading-relaxed text-muted" aria-live="polite">{summary}</p>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden items-center gap-1 text-[11px] text-faint sm:inline-flex" aria-hidden>
            <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd><Kbd>↵</Kbd>
          </span>
          <Button type="submit" variant="primary" size="lg" icon={<Rocket />} loading={submitting} disabled={!canLaunch} className="min-w-[180px]">
            {submitting ? "Launching…" : "Launch swarm"}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}
