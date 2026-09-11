"use client";
import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import { Database, GitFork } from "lucide-react";
import type { Approach, BranchStatus, Run, RunStatus } from "@/lib/types";
import { layoutTree, shortId, type LayoutOptions } from "@/lib/layout";
import { ApproachBadge } from "./ApproachBadge";
import { StatusPill, statusHex } from "./StatusPill";
import { confidenceColor } from "./ConfidenceBar";

// ── node data ───────────────────────────────────────────────────────────
interface RootData extends Record<string, unknown> { label: string; dbId: string | null; status: RunStatus; children: number; mode: string; compact: boolean }
interface BranchData extends Record<string, unknown> {
  title: string; approach?: Approach; status: BranchStatus; dbId: string | null; selected: boolean; steps: number; confidence: number | null; compact: boolean;
}
type RootNode = Node<RootData, "root">;
type BranchNode = Node<BranchData, "branch">;
type TreeNode = RootNode | BranchNode;

const NODE_W = 220;
const handleCls = "!size-2 !border-0 !bg-border-strong";
const hidden = { opacity: 0, pointerEvents: "none" as const };

/** Both handle sets are always rendered; the layout mode decides which pair the edges use (the other pair is invisible). */
function NodeHandles({ compact, target }: { compact: boolean; target: boolean }) {
  return (
    <>
      {target && <Handle id="t-top" type="target" position={Position.Top} className={handleCls} style={compact ? hidden : undefined} />}
      {target && <Handle id="t-left" type="target" position={Position.Left} className={handleCls} style={compact ? undefined : hidden} />}
      <Handle id="s-bottom" type="source" position={Position.Bottom} className={handleCls} style={compact ? hidden : undefined} />
      <Handle id="s-tree" type="source" position={Position.Bottom} className={handleCls} style={compact ? { left: 14 } : hidden} />
    </>
  );
}

const RootNodeView = memo(function RootNodeView({ data }: NodeProps<RootNode>) {
  const live = data.status !== "done" && data.status !== "failed";
  const hex = data.status === "failed" ? "#f87171" : data.dbId ? "#22d3ee" : "#fbbf24";
  return (
    <div className="rounded-xl border bg-surface-2 px-3 py-2 shadow-lg shadow-black/30" style={{ width: NODE_W, borderColor: `${hex}88`, boxShadow: `0 0 0 1px ${hex}22, 0 10px 30px -12px ${hex}55` }}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide" style={{ color: hex }}>
        <Database className="size-3" /> root {live && !data.dbId && <span className="ml-auto size-1.5 rounded-full bg-warn animate-pulse" />}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-text" title={data.label}>{data.label}</div>
      <div className="mono mt-0.5 flex items-center justify-between text-[10px] text-muted">
        <span title={data.dbId ?? "provisioning…"}>{data.dbId ? shortId(data.dbId) : "provisioning…"}</span>
        <span className="text-faint">{data.children} fork{data.children === 1 ? "" : "s"} · {data.mode}</span>
      </div>
      <NodeHandles compact={data.compact} target={false} />
    </div>
  );
});

const BranchNodeView = memo(function BranchNodeView({ data }: NodeProps<BranchNode>) {
  const hex = statusHex(data.status);
  return (
    <div
      className={clsx("relative rounded-xl border bg-surface-2 px-3 py-2 transition-shadow", data.status === "exploring" && "pulse-ring", data.selected && "ring-2 ring-accent")}
      style={{ width: NODE_W, borderColor: `${hex}88`, boxShadow: data.selected ? undefined : `0 8px 24px -12px ${hex}55` }}
    >
      <NodeHandles compact={data.compact} target />
      <div className="flex items-center gap-1.5">
        <GitFork className="size-3 shrink-0" style={{ color: hex }} />
        <span className="truncate text-[12px] font-semibold leading-tight text-text" title={data.title}>{data.title}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <ApproachBadge approach={data.approach} size="xs" />
        <StatusPill status={data.status} size="xs" />
        <span className="ml-auto mono text-[10px] text-faint" title={data.dbId ?? undefined}>{data.dbId ? shortId(data.dbId, 6) : "…"}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-faint">
        <span>{data.steps} step{data.steps === 1 ? "" : "s"}</span>
        {data.confidence !== null && <span className="tabular-nums" style={{ color: confidenceColor(data.confidence) }}>{Math.round(data.confidence * 100)}% conf</span>}
      </div>
    </div>
  );
});

const nodeTypes: NodeTypes = { root: RootNodeView, branch: BranchNodeView };

// ── graph derivation ───────────────────────────────────────────────────
export function buildLineageGraph(run: Run, selectedBranch: string | null, layout: LayoutOptions = {}): { nodes: TreeNode[]; edges: Edge[] } {
  const compact = layout.mode === "stack";
  const rootId = "root";
  const dbToBranch = new Map<string, string>();
  for (const b of run.branches) if (b.db?.id) dbToBranch.set(b.db.id, b.id);
  const parentOf = (bid: string): string => {
    const b = run.branches.find((x) => x.id === bid);
    const pid = b?.db?.parent_id;
    if (pid && dbToBranch.has(pid) && dbToBranch.get(pid) !== bid) return dbToBranch.get(pid)!;
    return rootId;
  };
  const inputs = [{ id: rootId, parent_id: null as string | null }, ...run.branches.map((b) => ({ id: b.id, parent_id: parentOf(b.id) }))];
  const pos = layoutTree(inputs, layout);
  // tree mode returns centers; stack mode returns left edges
  const at = (id: string) => { const p = pos.get(id) ?? { x: 0, y: 0 }; return { x: compact ? p.x : p.x - NODE_W / 2, y: p.y }; };

  const nodes: TreeNode[] = [
    {
      id: rootId, type: "root", position: at(rootId), draggable: false, selectable: false,
      data: { label: run.dataset_name || run.dataset_id, dbId: run.root_db?.id ?? null, status: run.status, children: run.branches.length, mode: run.modes?.data ?? "local", compact },
    },
    ...run.branches.map<BranchNode>((b) => {
      const h = run.plan.find((x) => x.id === b.hypothesis_id);
      return {
        id: b.id, type: "branch", position: at(b.id), draggable: false,
        data: {
          title: h?.title || `Branch ${shortId(b.id, 6)}`, approach: h?.approach, status: b.status, dbId: b.db?.id ?? null,
          selected: selectedBranch === b.id, steps: b.steps.length, confidence: b.finding ? b.finding.confidence : null, compact,
        },
      };
    }),
  ];
  const edges: Edge[] = run.branches.map((b) => {
    const hex = statusHex(b.status);
    const live = b.status === "exploring" || b.status === "forking";
    return {
      id: `e-${parentOf(b.id)}-${b.id}`, source: parentOf(b.id), target: b.id, type: "smoothstep", animated: live,
      sourceHandle: compact ? "s-tree" : "s-bottom", targetHandle: compact ? "t-left" : "t-top",
      style: { stroke: hex, strokeWidth: selectedBranch === b.id ? 2.2 : 1.4, opacity: b.status === "forking" ? 0.6 : 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color: hex, width: 14, height: 14 },
    };
  });
  return { nodes, edges };
}

function FitOnChange({ fitKey }: { fitKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => { void fitView({ padding: 0.15, duration: 450, maxZoom: 1 }); }, 60);
    return () => clearTimeout(t);
  }, [fitKey, fitView]);
  return null;
}

const flowVars = {
  "--xy-background-color": "transparent",
  "--xy-controls-button-background-color": "#141a2c",
  "--xy-controls-button-background-color-hover": "#1a2138",
  "--xy-controls-button-color": "#9aa3b8",
  "--xy-controls-button-color-hover": "#e6e9f2",
  "--xy-controls-button-border-color": "rgba(255,255,255,0.08)",
  "--xy-controls-box-shadow": "0 8px 24px -8px rgba(0,0,0,0.6)",
  "--xy-edge-stroke": "rgba(255,255,255,0.2)",
} as React.CSSProperties;

export function LineageTree({ run, selectedBranch, onSelect, className }: {
  run: Run; selectedBranch: string | null; onSelect: (branchId: string) => void; className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setWidth(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Narrow columns (the xl sidebar) get the vertical git-graph layout; wide containers get the classic fan-out tree.
  const layout = useMemo<LayoutOptions>(() => (width > 0 && width < 560 ? { mode: "stack" } : { mode: "tree" }), [width]);
  const { nodes, edges } = useMemo(() => buildLineageGraph(run, selectedBranch, layout), [run, selectedBranch, layout]);
  const fitKey = `${nodes.length}:${layout.mode}`;
  return (
    <div ref={wrapRef} className={clsx("relative h-full w-full overflow-hidden rounded-xl", className)} style={flowVars}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => { if (node.type === "branch") onSelect(node.id); }}
          className="!bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.10)" />
          <Controls showInteractive={false} position="bottom-right" className="!rounded-lg !overflow-hidden" />
          <FitOnChange fitKey={fitKey} />
        </ReactFlow>
      </ReactFlowProvider>
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 rounded-md bg-bg/60 px-2 py-1 text-[10px] text-faint backdrop-blur">
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-warn" />forking</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-accent-2" />exploring</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-success" />done</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-danger" />failed</span>
      </div>
    </div>
  );
}
