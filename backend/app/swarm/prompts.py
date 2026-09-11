"""Prompt builders for the planner, the analyst agents and the synthesizer (docs/SPEC.md §5).

Every SYSTEM prompt starts with a marker ("[[PLANNER]]", "[[AGENT]]", "[[SYNTH]]") so a fake LLM can key on it.
The USER prompts use stable `key: value` lines (branch_id, table_ref, text_column, "exactly N hypotheses", ...)
that both real models and the test fakes can rely on.
"""
from __future__ import annotations

from typing import Any

from app.swarm.models import Hypothesis, Metrics

PLANNER_MARKER = "[[PLANNER]]"
AGENT_MARKER = "[[AGENT]]"
SYNTH_MARKER = "[[SYNTH]]"

JSON_ONLY_NUDGE = (
    "Your previous reply was not valid JSON. Reply with ONE JSON object only — no prose, no markdown fences."
)

MAX_CELL = 80


# ── helpers ──────────────────────────────────────────────────────────────
def _cell(v: Any, width: int = MAX_CELL) -> str:
    if v is None:
        return "NULL"
    s = str(v).replace("\n", " ").replace("\r", " ")
    return s if len(s) <= width else s[: width - 1] + "…"


def format_schema(schema: list[tuple[str, str]] | list[dict[str, str]]) -> str:
    lines: list[str] = []
    for col in schema:
        if isinstance(col, dict):
            name, typ = col.get("name", "?"), col.get("type", "?")
        else:
            name, typ = col[0], col[1]
        lines.append(f"- {name}: {typ}")
    return "\n".join(lines) if lines else "- (schema unavailable)"


def format_rows(columns: list[str], rows: list[list[Any]], limit: int = 15) -> str:
    if not columns:
        return "(no columns)"
    head = " | ".join(columns)
    body = [" | ".join(_cell(v) for v in row) for row in rows[:limit]]
    if not body:
        return head + "\n(0 rows)"
    return head + "\n" + "\n".join(body)


def format_observation(columns: list[str], rows: list[list[Any]], row_count: int, limit: int = 15,
                       elapsed_ms: float | None = None) -> str:
    shown = min(len(rows), limit)
    meta = f"rows: {row_count} (showing {shown})"
    if elapsed_ms is not None:
        meta += f", {elapsed_ms:.0f} ms"
    return f"{meta}\n{format_rows(columns, rows, limit)}"


def format_profile(profile: dict[str, dict[str, Any]]) -> str:
    if not profile:
        return "- (not profiled)"
    lines: list[str] = []
    for col, p in profile.items():
        bits: list[str] = []
        for key in ("type", "distinct", "nulls", "min", "max"):
            if p.get(key) is not None:
                bits.append(f"{key}={_cell(p[key], 40)}")
        top = p.get("top") or []
        if top:
            tops = ", ".join(f"{_cell(t.get('value'), 24)}×{t.get('count')}" for t in top[:5] if isinstance(t, dict))
            if tops:
                bits.append(f"top=[{tops}]")
        lines.append(f"- {col}: " + ", ".join(bits))
    return "\n".join(lines)


def format_recalled(hits: list[dict[str, Any]]) -> str:
    if not hits:
        return "- none"
    out = []
    for h in hits[:8]:
        score = h.get("score")
        prefix = f"(score {float(score):.2f}) " if isinstance(score, (int, float)) else ""
        out.append(f"- {prefix}{_cell(h.get('text', ''), 400)}")
    return "\n".join(out)


# ── planner ──────────────────────────────────────────────────────────────
PLANNER_SYSTEM = f"""{PLANNER_MARKER} You are the planning lead of Parallax, a swarm of data analysts. Each analyst
works alone on an isolated forked copy of the dataset, so hypotheses must be independent and diverse: different
columns, different angles (segments, trends, drivers, anomalies, text themes), different tools.

Tools an analyst can use: "sql" (read-only aggregate SQL), "bm25" (keyword search over the text column),
"vector" (semantic search over the text column), or "mixed" (SQL plus search).

Respond with ONE JSON object only:
{{"hypotheses":[{{"title":"short, specific, testable","rationale":"why this could answer the question",
"approach":"sql"|"bm25"|"vector"|"mixed","target_columns":["col", ...]}}]}}

Rules:
- Produce EXACTLY the requested number of hypotheses, no more, no fewer.
- target_columns must be real column names from the schema.
- If a text column exists, include at least one "bm25" and at least one "vector" hypothesis about it.
- Prefer hypotheses that can be settled with GROUP BY aggregates and concrete numbers.
- No prose outside the JSON."""


def planner_prompts(*, dataset_name: str, schema: list[tuple[str, str]] | list[dict[str, str]],
                    profile: dict[str, dict[str, Any]], sample_columns: list[str], sample_rows: list[list[Any]],
                    question: str, recalled: list[dict[str, Any]], n: int,
                    text_column: str | None) -> tuple[str, str]:
    user = f"""Dataset: {dataset_name}
Question: {question}

Schema:
{format_schema(schema)}

Column profile:
{format_profile(profile)}

Sample rows ({min(len(sample_rows), 5)}):
{format_rows(sample_columns, sample_rows, 5)}

Text column: {text_column or "none"}

Prior knowledge (recalled from memory for this dataset):
{format_recalled(recalled)}

Produce exactly {n} hypotheses that together answer the question from different angles.
{"Include at least one bm25 and at least one vector hypothesis targeting the text column." if text_column else ""}
Return the JSON object now."""
    return PLANNER_SYSTEM, user


# ── agent ────────────────────────────────────────────────────────────────
AGENT_SYSTEM = f"""{AGENT_MARKER} You are a data analyst in the Parallax swarm. You work on your own isolated
FORKED database — nothing you do can affect other analysts. Investigate ONE hypothesis and report a finding.

Tools (one per turn):
- "sql": a single read-only SELECT (or WITH ... SELECT) over the fully-qualified table reference given as table_ref
  (for example `default.public.data` or `data`). Always use that exact reference.
- "bm25": keyword search over the text column. "query" is 2–6 plain keywords, e.g. "refund slow support".
  NOT SQL: no LIKE, no %, no quotes, no column names, no AND/OR. Returns matching rows with a `score`.
- "vector": semantic search over the text column. "query" is a short natural-language phrase describing the
  meaning you want, e.g. "customers frustrated about pricing". NOT SQL. Returns rows with `_distance` (lower = closer).
- "finish": stop and report your finding.

Respond with ONE JSON object only:
{{"thought":"one sentence of reasoning","action":"sql"|"bm25"|"vector"|"finish",
 "sql":"SELECT ... (only for action=sql)","query":"... (only for bm25/vector)",
 "finding":{{"claim":"one specific sentence with numbers","evidence":"the numbers / rows that support it",
 "confidence":0.0-1.0,"chart":{{"type":"bar"|"line"|"pie"|"number","title":"...","x":"col","y":"col",
 "data":[{{"col":"value", ...}}]}}}} (only for action=finish)}}

Rules:
- At most 4 tool steps, then you MUST finish. If remaining tool steps is 0, action must be "finish".
- Every SQL must include LIMIT 50 or smaller. Prefer aggregates: COUNT, AVG, SUM, GROUP BY, ORDER BY.
- Cite concrete numbers from your observations in claim and evidence. Never invent numbers.
- Never modify data: no INSERT/UPDATE/DELETE/CREATE/DROP. Never use tables other than table_ref
  (and vector_table_ref for vector search, which the tool handles for you).
- If a query errors, fix it in the next step rather than repeating it.
- Never repeat a step you already ran (same SQL or same query): the observation would be identical.
  Take a different angle (another column, a GROUP BY, a different phrase) or finish.
- After a search step, follow up with SQL that quantifies what you saw (counts, rates, averages).
- The chart is optional; when given, "data" must be small (≤ 12 rows) and taken from your observations.
- No prose outside the JSON."""


def agent_prompts(*, branch_id: str, table_ref: str, vector_table_ref: str | None, text_column: str | None,
                  question: str, hypothesis: Hypothesis, schema: list[tuple[str, str]] | list[dict[str, str]],
                  transcript: list[str], remaining: int, max_steps: int = 4) -> tuple[str, str]:
    transcript_text = "\n".join(transcript) if transcript else "(no steps yet)"
    finish_hint = ("Remaining tool steps is 0: you MUST respond with action \"finish\" now."
                   if remaining <= 0 else f"You may take up to {remaining} more tool step(s) before finishing.")
    user = f"""branch_id: {branch_id}
table_ref: {table_ref}
vector_table_ref: {vector_table_ref or "none"}
text_column: {text_column or "none"}
approach: {hypothesis.approach}
question: {question}

Hypothesis: {hypothesis.title}
Rationale: {hypothesis.rationale or "(none given)"}
Target columns: {", ".join(hypothesis.target_columns) if hypothesis.target_columns else "(any)"}

Schema:
{format_schema(schema)}

Transcript (previous steps and observations):
{transcript_text}

Remaining tool steps: {max(0, remaining)} of {max_steps}
{finish_hint}
Return the JSON object now."""
    return AGENT_SYSTEM, user


# ── synthesizer ──────────────────────────────────────────────────────────
SYNTH_SYSTEM = f"""{SYNTH_MARKER} You are the lead analyst of Parallax. Several analysts explored one question in
parallel, each on an isolated database branch. Combine their findings into ONE decisive, cited report.

Respond with ONE JSON object only:
{{"title":"...","executive_summary":"3-5 sentences answering the question directly",
 "markdown":"full report in Markdown with sections (Answer, Evidence, Caveats, Recommended next steps)",
 "key_findings":[{{"claim":"...","confidence":0.0-1.0,"branch_id":"b_1"}}],
 "next_questions":["...", "..."]}}

Rules:
- Every factual sentence in the markdown must cite its branch like [branch:b_3]; cite every branch you rely on.
- Weigh findings by confidence; call out contradictions explicitly.
- Use concrete numbers from the findings. Do not invent numbers.
- No prose outside the JSON."""


def synth_prompts(*, question: str, dataset_name: str, findings: list[dict[str, Any]],
                  metrics: Metrics) -> tuple[str, str]:
    if findings:
        blocks = []
        for f in findings:
            conf = f.get("confidence")
            conf_s = f"{float(conf):.2f}" if isinstance(conf, (int, float)) else "n/a"
            blocks.append(
                f"- branch_id: {f.get('branch_id')} | hypothesis: {_cell(f.get('hypothesis'), 200)} | "
                f"approach: {f.get('approach')} | confidence: {conf_s}\n"
                f"  claim: {_cell(f.get('claim'), 600)}\n"
                f"  evidence: {_cell(f.get('evidence'), 800)}\n"
                f"  status: {f.get('status', 'done')}"
            )
        findings_text = "\n".join(blocks)
    else:
        findings_text = "- (no branch produced a finding)"
    m = metrics
    user = f"""Question: {question}
Dataset: {dataset_name}

Findings:
{findings_text}

Metrics: databases={m.databases_created}, forks={m.forks}, queries={m.queries}, peak_concurrency={m.peak_concurrency}, p50_ms={m.p50_ms:.1f}, p95_ms={m.p95_ms:.1f}, llm_calls={m.llm_calls}

Write the report JSON now. Cite branches as [branch:<branch_id>]."""
    return SYNTH_SYSTEM, user
