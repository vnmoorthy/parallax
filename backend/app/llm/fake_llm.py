"""FakeLLM — deterministic, network-free provider used by tests, CI and ``PARALLAX_LLM_MODE=fake``.

Behaviour is keyed on markers in the *system* prompt (docs/SPEC.md §5, "Fake LLM for tests"):

* ``[[PLANNER]]`` → ``{"hypotheses": [...]}`` with exactly N items (N parsed from "exactly N hypotheses" in the
  user prompt, default 3), approaches cycling sql → bm25 → vector → mixed, target_columns taken from column
  names found in the prompt.
* ``[[AGENT]]``   → per-branch scripted tool loop: first call runs ``SELECT COUNT(*)``, following calls finish.
* ``[[SYNTH]]``   → a report whose markdown cites every ``[branch:<id>]`` mentioned in the prompt.
* anything else  → ``{"ok": true}`` (or the string ``"ok"`` when ``json_mode`` is False).
"""
from __future__ import annotations

import json
import re

_N_RE = re.compile(r"exactly\s+(\d+)\s+hypothes", re.IGNORECASE)
_TEXT_COL_RE = re.compile(r"text[ _-]?columns?\s*[:=]\s*[`'\"\[]*\s*([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE)
_TYPED_COL_RE = re.compile(
    r"(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s*[:(]?\s*"
    r"(VARCHAR|TEXT|STRING|INTEGER|INT|BIGINT|SMALLINT|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC|BOOLEAN|BOOL|DATE|TIMESTAMP|UTF8|INT64|FLOAT64)\b",
    re.IGNORECASE)
_JSON_NAME_RE = re.compile(r'"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"')
_BRANCH_RE = re.compile(r"branch(?:_id)?\s*[:=]\s*[\"'`]?([A-Za-z0-9_-]+)", re.IGNORECASE)
_BRANCH_CITE_RE = re.compile(r"\[branch:([^\]\s]+)\]")
_TABLE_REF_RE = re.compile(r"table(?:_ref|_name)?\s*[:=]\s*[`'\"]?([A-Za-z_][A-Za-z0-9_.]*)", re.IGNORECASE)
_FROM_RE = re.compile(r"\bFROM\s+([A-Za-z_][A-Za-z0-9_.]*)", re.IGNORECASE)
_SQL_KEYWORDS = {"select", "from", "where", "group", "order", "limit", "as", "and", "or", "by", "null", "not",
                 "table", "column", "columns", "type", "name", "rows", "row", "count", "schema"}

APPROACHES = ("sql", "bm25", "vector", "mixed")


def _columns_in(prompt: str) -> list[str]:
    found: list[str] = []
    for m in _JSON_NAME_RE.finditer(prompt):
        found.append(m.group(1))
    for m in _TYPED_COL_RE.finditer(prompt):
        found.append(m.group(1))
    out: list[str] = []
    for c in found:
        if c.lower() in _SQL_KEYWORDS or c.startswith("__") or c.endswith("__emb"):
            continue
        if c not in out:
            out.append(c)
    return out


class FakeLLM:
    name = "fake"

    def __init__(self) -> None:
        self._agent_calls: dict[str, int] = {}
        self.calls = 0

    async def healthy(self) -> bool:
        return True

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        self.calls += 1
        system = system or ""
        user = user or ""
        if "[[PLANNER]]" in system:
            return json.dumps(self._plan(user))
        if "[[AGENT]]" in system:
            return json.dumps(self._agent(user))
        if "[[SYNTH]]" in system:
            return json.dumps(self._synth(user))
        return json.dumps({"ok": True}) if json_mode else "ok"

    # ── planner ─────────────────────────────────────────────────────────────
    def _plan(self, user: str) -> dict:
        m = _N_RE.search(user)
        n = max(1, int(m.group(1))) if m else 3
        cols = _columns_in(user)
        tm = _TEXT_COL_RE.search(user)
        text_col = tm.group(1) if tm else next((c for c in cols if c in ("feedback", "review_text", "description", "text", "comment", "notes")), None)
        hypotheses = []
        for i in range(n):
            approach = APPROACHES[i % len(APPROACHES)]
            if approach in ("bm25", "vector") and text_col:
                targets = [text_col]
            elif cols:
                targets = [cols[(i * 2) % len(cols)], cols[(i * 2 + 1) % len(cols)]]
                targets = list(dict.fromkeys(targets))
            else:
                targets = []
            hypotheses.append({
                "id": f"h{i + 1}",
                "title": f"Hypothesis {i + 1}: {approach} angle on {', '.join(targets) or 'the data'}",
                "rationale": f"Deterministic fake hypothesis #{i + 1} exploring the question via {approach}.",
                "approach": approach,
                "target_columns": targets,
            })
        return {"hypotheses": hypotheses}

    # ── agent ───────────────────────────────────────────────────────────────
    def _agent(self, user: str) -> dict:
        bm = _BRANCH_RE.search(user)
        branch = bm.group(1) if bm else "_"
        step = self._agent_calls.get(branch, 0) + 1
        self._agent_calls[branch] = step
        if step == 1:
            tm = _TABLE_REF_RE.search(user) or _FROM_RE.search(user)
            table = tm.group(1) if tm else "data"
            return {
                "thought": "Start by sizing the table so later findings can quote a denominator.",
                "action": "sql",
                "sql": f"SELECT COUNT(*) AS n FROM {table}",
            }
        return {
            "thought": "Enough evidence gathered; summarise.",
            "action": "finish",
            "finding": {
                "claim": f"Fake finding for branch {branch}: the table was profiled successfully.",
                "evidence": "Row count query executed; deterministic fake evidence.",
                "confidence": 0.7,
                "chart": None,
            },
        }

    # ── synthesizer ─────────────────────────────────────────────────────────
    def _synth(self, user: str) -> dict:
        """Deterministic synthesis: parses the findings blocks from the prompt and writes an honest report."""
        findings: list[dict] = []
        block_re = re.compile(
            r"- branch_id: (?P<bid>[A-Za-z0-9_\-]+) \| hypothesis: (?P<hyp>.*?) \| approach: (?P<app>\w+) \| "
            r"confidence: (?P<conf>[0-9.]+|n/a)\n\s*claim: (?P<claim>.*?)\n\s*evidence: (?P<ev>.*?)\n\s*status:",
            re.S,
        )
        for m in block_re.finditer(user):
            try:
                conf = float(m.group("conf"))
            except ValueError:
                conf = 0.5
            findings.append({"branch_id": m.group("bid"), "hypothesis": m.group("hyp").strip(),
                             "approach": m.group("app"), "confidence": conf,
                             "claim": m.group("claim").strip(), "evidence": m.group("ev").strip()})
        if not findings:  # older/other prompt shapes: fall back to any cited branch ids
            ids: list[str] = []
            for m in list(_BRANCH_CITE_RE.finditer(user)) + list(_BRANCH_RE.finditer(user)):
                bid = m.group(1)
                if "<" in bid or ">" in bid or bid.lower() in ("id", "branch_id"):
                    continue
                if bid not in ids:
                    ids.append(bid)
            findings = [{"branch_id": b, "hypothesis": "", "approach": "sql", "confidence": 0.5,
                         "claim": f"Branch {b} completed its exploration.", "evidence": ""} for b in ids]
        qm = re.search(r"^Question: (.*)$", user, re.M)
        question = qm.group(1).strip() if qm else "the question"
        dm = re.search(r"^Dataset: (.*)$", user, re.M)
        dataset = dm.group(1).strip() if dm else "the dataset"
        ranked = sorted(findings, key=lambda x: -x["confidence"])
        top = ranked[:3]
        exec_summary = (
            f"{len(findings)} analyst branch(es) explored '{question}' on {dataset}. "
            + " ".join(f"{x['claim']} [branch:{x['branch_id']}]" for x in top)
        ).strip()
        lines = ["## Executive summary", exec_summary, "",
                 "_Synthesized deterministically because no LLM provider was available for the final step; every "
                 "claim below is quoted verbatim from the analyst branches._", "", "## Findings"]
        for x in ranked:
            lines.append(f"### {x['hypothesis'] or 'Branch ' + x['branch_id']} [branch:{x['branch_id']}]")
            lines.append(f"- **Claim** ({x['confidence']:.0%} confidence, via {x['approach']}): {x['claim']}")
            if x["evidence"]:
                lines.append(f"- **Evidence:** {x['evidence']}")
            lines.append("")
        lines.append("## Where to look next")
        nq = [f"Which segment drives the effect behind: {x['hypothesis'] or x['claim'][:60]}?" for x in top]
        nq += ["What changed over time, and is the trend accelerating?"]
        lines += [f"- {q}" for q in nq]
        return {
            "title": f"Parallax report: {question[:80]}",
            "executive_summary": exec_summary[:600],
            "markdown": "\n".join(lines),
            "key_findings": [{"branch_id": x["branch_id"], "claim": x["claim"], "confidence": x["confidence"]} for x in ranked],
            "next_questions": nq,
        }
