// Shared API types — mirrors backend/app/swarm/models.py (docs/SPEC.md §5). Keep in sync.

export type DataMode = "hotdata" | "local";
export type LLMProvider = "rocketride" | "anthropic" | "ollama" | "fake";
export type MemoryKind = "cognee" | "local";

export interface Health {
  ok: boolean;
  version: string;
  data: { mode: string; kind: DataMode; detail: string };
  llm: { chain: LLMProvider[]; active: LLMProvider | null; detail?: string };
  memory: { kind: MemoryKind; detail?: string };
  rocketride: { configured: boolean; reachable: boolean; uri?: string | null; cloud?: boolean };
  hotdata?: { configured: boolean; reachable: boolean };
  cognee?: { configured: boolean; active: boolean };
}

export interface DatasetColumn { name: string; type: string }
export interface Dataset {
  id: string;
  name: string;
  description: string;
  rows: number;
  columns: DatasetColumn[];
  source: "bundled" | "upload";
  text_columns: string[];
  suggested_questions: string[];
}
export interface ColumnProfile {
  type: string; nulls: number; distinct: number;
  min?: number | string | null; max?: number | string | null;
  top?: { value: string; count: number }[];
}
export interface DatasetPreview {
  columns: string[];
  rows: (string | number | null)[][];
  profile: Record<string, ColumnProfile>;
}

export interface DB {
  id: string; name: string; parent_id: string | null;
  created_at: string; expires_at: string | null; connection_id?: string | null;
}
export interface QueryResult {
  columns: string[]; rows: (string | number | boolean | null)[][];
  row_count: number; elapsed_ms: number; truncated?: boolean; sql?: string;
}
export interface LineageNode { id: string; name: string; parent_id: string | null; created_at: string; exists?: boolean }

export type RunStatus = "queued" | "provisioning" | "planning" | "exploring" | "synthesizing" | "done" | "failed";
export type BranchStatus = "forking" | "exploring" | "done" | "failed";
export type Approach = "sql" | "bm25" | "vector" | "mixed";
export type StepKind = "think" | "sql" | "bm25" | "vector" | "observe" | "finding";

export interface Hypothesis { id: string; title: string; rationale: string; approach: Approach; target_columns: string[] }
export interface AgentStep {
  n: number; kind: StepKind; text: string;
  sql?: string | null; result?: QueryResult | null; elapsed_ms?: number | null; provider?: string | null;
}
export interface ChartSpec {
  type: "bar" | "line" | "pie" | "number";
  title: string; x?: string | null; y?: string | null; data: Record<string, string | number | null>[];
}
export interface Finding {
  claim: string; evidence: string; confidence: number;
  supporting_sql: string[]; chart?: ChartSpec | null; tags: string[];
}
export interface Branch {
  id: string; hypothesis_id: string; db: DB | null; status: BranchStatus;
  steps: AgentStep[]; finding: Finding | null;
}
export interface MemoryHit { text: string; score: number; tags: string[]; created_at?: string | null }
export interface Report {
  title: string; executive_summary: string; markdown: string;
  key_findings: { claim: string; confidence: number; branch_id: string }[];
  next_questions: string[];
  citations: { branch_id: string; hypothesis: string }[];
}
export interface BurstResult {
  count: number; p50_ms: number; p95_ms: number; max_ms: number; total_ms: number; per_query: number[];
  concurrency?: number;
}
export interface Metrics {
  databases_created: number; forks: number; queries: number; peak_concurrency: number;
  p50_ms: number; p95_ms: number; llm_calls: number; llm_calls_by_provider: Record<string, number>;
  started_at: string; finished_at: string | null; elapsed_ms: number | null;
  time_to_first_finding_ms: number | null; burst: BurstResult | null;
}
export interface Run {
  id: string; created_at: string; status: RunStatus;
  dataset_id: string; dataset_name: string; question: string; agents: number;
  modes: { data: DataMode; llm: LLMProvider | string; memory: MemoryKind };
  root_db: DB | null; branches: Branch[]; recalled: MemoryHit[]; plan: Hypothesis[];
  report: Report | null; metrics: Metrics; error: string | null;
}
export interface RunSummary {
  id: string; created_at: string; status: RunStatus; dataset_name: string; question: string;
  agents: number; elapsed_ms: number | null; p50_ms: number | null; queries: number; modes: Run["modes"];
}

export type EventType =
  | "run.status" | "run.recalled" | "run.plan" | "db.created" | "db.forked"
  | "agent.step" | "agent.finding" | "branch.status" | "metrics.update" | "metrics.burst"
  | "report.ready" | "memory.remembered" | "run.error" | "run.finished";

export interface RunEvent {
  ts: string; type: EventType; run_id: string; branch_id?: string | null;
  payload: Record<string, unknown>;
}

export interface ApiError { error: { code: string; message: string } }
