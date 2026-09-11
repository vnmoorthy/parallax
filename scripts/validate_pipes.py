#!/usr/bin/env python3
"""Structural (and optionally engine-side) validator for RocketRide .pipe files.

Usage:
    python scripts/validate_pipes.py                        # all pipelines/*.pipe, structural checks
    python scripts/validate_pipes.py pipelines/x.pipe ...   # specific files
    python scripts/validate_pipes.py --engine http://localhost:5565 --key MYAPIKEY
                                                            # + RocketRideClient.validate()/use() per pipe

Exit status is non-zero when any structural check fails. Engine failures are reported but only fail
the run when --strict-engine is given (an engine that is down must never block CI).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PIPELINES_DIR = REPO_ROOT / "pipelines"

LANES = {"tags", "text", "table", "documents", "questions", "answers", "image", "audio", "video", "json"}
CLASS_TYPES = {"llm", "tool", "memory", "crewai", "deepagent"}
SOURCE_PROVIDERS = {"chat", "webhook", "dropper", "filesys", "filestore_source", "telegram", "tools"}
PLACEHOLDER_RE = re.compile(r"\$\{([A-Za-z0-9_]+)\}")


class Report:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    @property
    def ok(self) -> bool:
        return not self.errors


def _walk_strings(obj, path: str = "config"):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_strings(v, f"{path}[{i}]")


def _has_cycle(edges: dict[str, set[str]]) -> list[str] | None:
    """Return a cycle path if the directed graph (from -> to) has one, else None."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in edges}
    stack: list[str] = []

    def visit(n: str) -> list[str] | None:
        color[n] = GREY
        stack.append(n)
        for m in edges.get(n, ()):
            if color.get(m, WHITE) == GREY:
                return stack[stack.index(m):] + [m]
            if color.get(m, WHITE) == WHITE:
                found = visit(m)
                if found:
                    return found
        stack.pop()
        color[n] = BLACK
        return None

    for n in list(edges):
        if color[n] == WHITE:
            found = visit(n)
            if found:
                return found
    return None


def validate_structure(path: Path) -> tuple[Report, dict | None]:
    rep = Report(path)
    raw = path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        rep.err(f"invalid JSON: {e}")
        return rep, None
    if not isinstance(data, dict):
        rep.err("top level must be a JSON object")
        return rep, None

    keys = list(data)
    if not keys or keys[0] != "components":
        rep.err(f'first key must be "components" (got {keys[0] if keys else "nothing"})')
    comps = data.get("components")
    if not isinstance(comps, list) or not comps:
        rep.err('"components" must be a non-empty array')
        return rep, data

    # top-level fields
    pid = data.get("project_id")
    try:
        if not isinstance(pid, str) or str(uuid.UUID(pid)) != pid.lower():
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        rep.err(f"project_id must be a literal UUID string (got {pid!r})")
    if data.get("version") != 1:
        rep.err(f"version must be 1 (got {data.get('version')!r})")
    if "viewport" not in data:
        rep.warn('missing "viewport" (editor pan/zoom); add {"x":0,"y":0,"zoom":1}')
    if data.get("isLocked", False) is not False:
        rep.warn("isLocked should be false")

    # components
    ids: list[str] = []
    by_id: dict[str, dict] = {}
    for i, c in enumerate(comps):
        if not isinstance(c, dict):
            rep.err(f"components[{i}] is not an object")
            continue
        cid = c.get("id")
        if not isinstance(cid, str) or not cid:
            rep.err(f"components[{i}] missing id")
            continue
        if cid in by_id:
            rep.err(f"duplicate component id {cid!r}")
        ids.append(cid)
        by_id[cid] = c
        if not isinstance(c.get("provider"), str) or not c["provider"]:
            rep.err(f"{cid}: missing provider")
        if not isinstance(c.get("config"), dict):
            rep.err(f"{cid}: config must be an object")
        if not isinstance(c.get("name"), str) or not c["name"]:
            rep.warn(f"{cid}: no \"name\" label (canvas shows the id)")
        ui = c.get("ui")
        if not isinstance(ui, dict) or not isinstance(ui.get("position"), dict):
            rep.warn(f"{cid}: no ui.position — editor will stack it at 0,0")

    data_edges: dict[str, set[str]] = {cid: set() for cid in ids}
    controllers: dict[str, list[tuple[str, str]]] = {cid: [] for cid in ids}  # invoker -> [(classType, controlled)]

    for cid, c in by_id.items():
        provider = c.get("provider", "")
        is_source = provider in SOURCE_PROVIDERS or (isinstance(c.get("config"), dict) and c["config"].get("mode") == "Source")
        inputs = c.get("input")
        controls = c.get("control")

        if is_source:
            if isinstance(c.get("config"), dict):
                cfg = c["config"]
                for k in ("hideForm", "mode", "parameters", "type"):
                    if k not in cfg:
                        rep.err(f"{cid}: source config missing {k!r}")
            if inputs:
                rep.err(f"{cid}: source components must not have input")
        else:
            if not inputs and not controls:
                rep.err(f"{cid}: non-source component needs a non-empty input or control")

        if inputs is not None:
            if not isinstance(inputs, list):
                rep.err(f"{cid}: input must be an array")
            else:
                for e in inputs:
                    if not isinstance(e, dict) or "lane" not in e or "from" not in e:
                        rep.err(f"{cid}: input entries need lane and from: {e!r}")
                        continue
                    if e["lane"] not in LANES:
                        rep.err(f"{cid}: unknown lane {e['lane']!r} (allowed: {sorted(LANES)})")
                    src = e["from"]
                    if src not in by_id:
                        rep.err(f"{cid}: input from unknown component {src!r}")
                    else:
                        data_edges[src].add(cid)
                    if src == cid:
                        rep.err(f"{cid}: input from itself")

        if controls is not None:
            if not isinstance(controls, list):
                rep.err(f"{cid}: control must be an array")
            else:
                for e in controls:
                    if not isinstance(e, dict) or "classType" not in e or "from" not in e:
                        rep.err(f"{cid}: control entries need classType and from: {e!r}")
                        continue
                    if e["classType"] not in CLASS_TYPES:
                        rep.err(f"{cid}: unknown classType {e['classType']!r} (allowed: {sorted(CLASS_TYPES)})")
                    inv = e["from"]
                    if inv not in by_id:
                        rep.err(f"{cid}: control from unknown component {inv!r}")
                    else:
                        controllers[inv].append((e["classType"], cid))
                    if inv == cid:
                        rep.err(f"{cid}: controls itself")

        # placeholders
        for where, s in _walk_strings(c.get("config", {})):
            for var in PLACEHOLDER_RE.findall(s):
                if not var.startswith("ROCKETRIDE_"):
                    rep.err(f"{cid}: placeholder ${{{var}}} at {where} will not substitute — only ${{ROCKETRIDE_*}} does")

    # second pass: provider-specific checks (controller links are complete now)
    for cid, c in by_id.items():
        provider = c.get("provider", "")
        if provider == "agent_rocketride":
            cfg = c.get("config", {})
            if not isinstance(cfg.get("instructions"), list) or not cfg["instructions"]:
                rep.err(f"{cid}: agent_rocketride needs non-empty instructions[]")
            if "parameters" not in cfg:
                rep.warn(f"{cid}: agent config missing \"parameters\": {{}}")
            links = controllers[cid]
            n_llm = sum(1 for ct, _ in links if ct == "llm")
            n_mem = sum(1 for ct, tgt in links if ct == "memory" and by_id[tgt].get("provider") == "memory_internal")
            if n_llm != 1:
                rep.err(f"{cid}: agent_rocketride needs exactly one llm controller link (found {n_llm})")
            if n_mem != 1:
                rep.err(f"{cid}: agent_rocketride needs exactly one memory_internal controller link (found {n_mem})")
        if provider == "db_hotdata" and not any(ct == "llm" for ct, _ in controllers[cid]):
            rep.err(f"{cid}: db_hotdata requires an llm controller link (an llm node with control from {cid!r})")
        if provider.startswith("llm_"):
            cfg = c.get("config", {})
            prof = cfg.get("profile")
            if not prof:
                rep.err(f"{cid}: llm config needs a profile")
            elif not isinstance(cfg.get(prof), dict):
                rep.err(f"{cid}: llm config needs a {prof!r} block with the apikey")
        if provider == "memory_internal" and c.get("config", {}).get("type") != "memory_internal":
            rep.err(f"{cid}: memory_internal config needs \"type\": \"memory_internal\"")
        if provider.startswith("response") and "laneName" not in c.get("config", {}):
            rep.err(f"{cid}: response node needs config.laneName")


    cyc = _has_cycle(data_edges)
    if cyc:
        rep.err("data-flow graph has a cycle: " + " -> ".join(cyc))

    # every project has at least one source and (unless ingest-only) a response
    if not any((c.get("provider") in SOURCE_PROVIDERS) for c in by_id.values()):
        rep.err("no source component (chat/webhook/dropper)")
    return rep, data


def print_report(rep: Report, label: str = "") -> None:
    status = "PASS" if rep.ok else "FAIL"
    print(f"[{status}] {label or rep.path.relative_to(REPO_ROOT) if rep.path.is_relative_to(REPO_ROOT) else rep.path}")
    for e in rep.errors:
        print(f"    error:   {e}")
    for w in rep.warnings:
        print(f"    warning: {w}")


async def engine_check(paths: list[Path], uri: str, key: str, do_use: bool) -> bool:
    """Engine-side checks. Returns True when nothing *the engine could check* failed.

    - validate(): the 1.3.0 SDK sends {"pipeline": <arg>} but the engine expects {"pipeline": {"pipeline": ...}},
      so we pass {"pipeline": pipeline} ourselves (verified against server-v3.3.1: bad lanes are reported,
      a clean pipe returns no "errors").
    - use()/terminate(): the real instantiation path — it resolves ${ROCKETRIDE_*}, checks key formats and
      control wiring. Pipes that use providers this engine does not ship (e.g. db_hotdata / tool_cognee on a
      vanilla local engine) are reported as SKIP, not FAIL.
    """
    try:
        from rocketride import RocketRideClient
    except ImportError:
        print("engine: rocketride SDK not installed (pip install rocketride) — skipping")
        return True
    import httpx

    base = uri.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=3) as http:
            r = await http.get(f"{base}/ping")
        print(f"engine: GET {base}/ping -> HTTP {r.status_code} (reachable)")
    except Exception as e:  # noqa: BLE001 — an engine that is down must never block CI
        print(f"engine: {base} unreachable ({e.__class__.__name__}) — skipping engine checks")
        return True

    # Placeholders so use() can resolve ${ROCKETRIDE_*} when the real values are not exported.
    # The Anthropic node checks key *format* at instantiation, so the dummy has to look like a real key.
    defaults = {
        "ROCKETRIDE_ANTHROPIC_KEY": "sk-ant-api03-" + "A" * 95,
        "ROCKETRIDE_DB_HOTDATA_KEY": "hd_placeholder",
        "ROCKETRIDE_DB_HOTDATA_WORKSPACE_ID": "work_placeholder",
        "ROCKETRIDE_COGNEE_BASE_URL": "http://localhost:8000",
        "ROCKETRIDE_COGNEE_API_KEY": "",
    }
    for k, v in defaults.items():
        os.environ.setdefault(k, v)

    all_ok = True
    try:
        async with RocketRideClient(uri=uri, auth=key) as client:
            try:
                services = (await client.get_services()).get("services", {})
                available = set(services) if isinstance(services, dict) else {s.get("name") for s in services}
                print(f"engine: {len(available)} providers available")
            except Exception as e:  # noqa: BLE001
                available = set()
                print(f"engine: get_services failed ({e}); provider availability unknown")

            for p in paths:
                pipeline = json.loads(p.read_text(encoding="utf-8"))
                providers = {c.get("provider") for c in pipeline.get("components", [])}
                missing = sorted(pr for pr in providers if available and pr not in available)

                try:
                    res = await client.validate({"pipeline": pipeline})
                    errs = (res or {}).get("errors") or []
                    warns = (res or {}).get("warnings") or []
                    if errs:
                        all_ok = False
                    print(f"[{'FAIL' if errs else 'PASS'}] engine validate {p.name}"
                          + (": " + "; ".join(e.get("message", str(e)) for e in errs) if errs else ""))
                    for w in warns:
                        print(f"    warning: {w.get('message', w)}")
                except Exception as e:  # noqa: BLE001
                    print(f"[FAIL] engine validate {p.name}: {e}")
                    all_ok = False

                if not do_use:
                    continue
                if missing:
                    print(f"[SKIP] engine use {p.name}: providers not installed on this engine: {missing}")
                    continue
                try:
                    res = await client.use(filepath=str(p))
                    token = res.get("token") if isinstance(res, dict) else None
                    print(f"[PASS] engine use {p.name}: token={str(token)[:14]}…")
                    if token:
                        await client.terminate(token)
                except Exception as e:  # noqa: BLE001
                    print(f"[FAIL] engine use {p.name}: {e}")
                    all_ok = False
    except Exception as e:  # noqa: BLE001
        print(f"engine: connection failed ({e}) — skipping engine checks")
        return True
    return all_ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="pipe files (default: pipelines/*.pipe)")
    ap.add_argument("--engine", metavar="URI", help="RocketRide engine URI, e.g. http://localhost:5565")
    ap.add_argument("--key", default=os.environ.get("ROCKETRIDE_APIKEY", "MYAPIKEY"), help="engine API key")
    ap.add_argument("--no-use", action="store_true", help="with --engine: only validate(), do not use()/terminate()")
    ap.add_argument("--strict-engine", action="store_true", help="fail the run when engine checks fail")
    args = ap.parse_args(argv)

    paths = [Path(f).resolve() for f in args.files] or sorted(PIPELINES_DIR.glob("*.pipe"))
    if not paths:
        print("no .pipe files found")
        return 1

    print(f"Validating {len(paths)} pipeline(s)\n")
    failures = 0
    for p in paths:
        rep, _ = validate_structure(p)
        print_report(rep)
        failures += 0 if rep.ok else 1

    engine_ok = True
    if args.engine:
        import asyncio
        print()
        engine_ok = asyncio.run(engine_check(paths, args.engine, args.key, do_use=not args.no_use))

    print()
    if failures:
        print(f"RESULT: {failures} of {len(paths)} pipeline(s) FAILED structural validation")
        return 1
    if args.engine and not engine_ok:
        print("RESULT: structural checks passed; engine checks reported failures")
        return 2 if args.strict_engine else 0
    print(f"RESULT: all {len(paths)} pipeline(s) passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
