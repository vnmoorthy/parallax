"use client";
import "@xyflow/react/dist/style.css";
import { memo } from "react";
import clsx from "clsx";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { Bot, Brain, Cloud, Database, ExternalLink, MessageSquare, Network, Reply, Sparkles, Wrench } from "lucide-react";
import type { Run } from "@/lib/types";

type PipeKind = "input" | "agent" | "output" | "llm" | "memory" | "tool";
interface PipeData extends Record<string, unknown> { label: string; sub: string; kind: PipeKind; id: string }
type PipeNode = Node<PipeData, "pipe">;

const KIND: Record<PipeKind, { hex: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; tag: string }> = {
  input:  { hex: "#9aa3b8", Icon: MessageSquare, tag: "input" },
  agent:  { hex: "#6366f1", Icon: Bot,           tag: "agent" },
  output: { hex: "#9aa3b8", Icon: Reply,         tag: "response" },
  llm:    { hex: "#a5b4fc", Icon: Sparkles,      tag: "llm" },
  memory: { hex: "#34d399", Icon: Brain,         tag: "memory" },
  tool:   { hex: "#22d3ee", Icon: Wrench,        tag: "tool" },
};

const PipeNodeView = memo(function PipeNodeView({ data }: NodeProps<PipeNode>) {
  const k = KIND[data.kind];
  const Icon = k.Icon;
  const isAgent = data.kind === "agent";
  return (
    <div className={clsx("rounded-xl border bg-surface-2 px-3 py-2", isAgent && "glow")} style={{ width: isAgent ? 230 : 168, borderColor: `${k.hex}77`, boxShadow: isAgent ? undefined : `0 8px 20px -12px ${k.hex}66` }}>
      <Handle id="in" type="target" position={Position.Left} className="!size-2 !border-0 !bg-border-strong" />
      <Handle id="top" type="target" position={Position.Top} className="!size-2 !border-0 !bg-border-strong" />
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide" style={{ color: k.hex }}>
        <Icon className="size-3" /> {k.tag}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-text" title={data.label}>{data.label}</div>
      <div className="mono mt-0.5 truncate text-[10px] text-faint" title={data.sub}>{data.sub}</div>
      <Handle id="out" type="source" position={Position.Right} className="!size-2 !border-0 !bg-border-strong" />
      <Handle id="ctl" type="source" position={Position.Bottom} className="!size-2 !border-0 !bg-border-strong" />
      <Handle id="side" type="source" position={Position.Left} className="!size-2 !border-0 !bg-border-strong !top-[70%]" />
      <Handle id="side-in" type="target" position={Position.Right} className="!size-2 !border-0 !bg-border-strong !top-[70%]" />
    </div>
  );
});

const nodeTypes: NodeTypes = { pipe: PipeNodeView };

const NODES: PipeNode[] = [
  { id: "chat_1", type: "pipe", position: { x: 0, y: 70 }, draggable: false, data: { id: "chat_1", label: "chat_1", sub: "question → lane: questions", kind: "input" } },
  { id: "agent_rocketride_1", type: "pipe", position: { x: 230, y: 60 }, draggable: false, data: { id: "agent_rocketride_1", label: "Parallax Analyst", sub: "agent_rocketride · max_waves 12", kind: "agent" } },
  { id: "response_answers_1", type: "pipe", position: { x: 530, y: 70 }, draggable: false, data: { id: "response_answers_1", label: "response_answers_1", sub: '{"laneName":"answers"}', kind: "output" } },
  { id: "memory_internal_1", type: "pipe", position: { x: -40, y: 250 }, draggable: false, data: { id: "memory_internal_1", label: "memory_internal", sub: "conversation memory", kind: "memory" } },
  { id: "llm_anthropic_1", type: "pipe", position: { x: 160, y: 250 }, draggable: false, data: { id: "llm_anthropic_1", label: "Claude", sub: "llm_anthropic · claude-sonnet-4-6", kind: "llm" } },
  { id: "db_hotdata_1", type: "pipe", position: { x: 360, y: 250 }, draggable: false, data: { id: "db_hotdata_1", label: "Hotdata tool", sub: "db_hotdata · table data · execute", kind: "tool" } },
  { id: "tool_cognee_1", type: "pipe", position: { x: 560, y: 250 }, draggable: false, data: { id: "tool_cognee_1", label: "Cognee tool", sub: "dataset parallax · GRAPH_COMPLETION", kind: "tool" } },
];

const flow = (id: string, source: string, target: string): Edge => ({
  id, source, target, sourceHandle: "out", targetHandle: "in", type: "smoothstep", animated: true,
  style: { stroke: "#6366f1", strokeWidth: 1.8 }, markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1", width: 14, height: 14 },
});
const control = (id: string, source: string, target: string, label: string, hex: string, handles: { s?: string; t?: string } = {}): Edge => ({
  id, source, target, sourceHandle: handles.s ?? "ctl", targetHandle: handles.t ?? "top", type: "smoothstep", label,
  style: { stroke: hex, strokeWidth: 1.4, strokeDasharray: "5 4", opacity: 0.9 },
  labelStyle: { fill: hex, fontSize: 9, fontWeight: 600, letterSpacing: 0.4 },
  labelBgStyle: { fill: "#0e1220", fillOpacity: 0.95 }, labelBgPadding: [4, 2], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: hex, width: 12, height: 12 },
});

const EDGES: Edge[] = [
  flow("f1", "chat_1", "agent_rocketride_1"),
  flow("f2", "agent_rocketride_1", "response_answers_1"),
  control("c1", "agent_rocketride_1", "llm_anthropic_1", "control · llm", "#a5b4fc"),
  control("c2", "agent_rocketride_1", "memory_internal_1", "control · memory", "#34d399"),
  control("c3", "agent_rocketride_1", "db_hotdata_1", "control · tool", "#22d3ee"),
  control("c4", "agent_rocketride_1", "tool_cognee_1", "control · tool", "#22d3ee"),
  control("c5", "db_hotdata_1", "llm_anthropic_1", "llm", "#a5b4fc", { s: "side", t: "side-in" }),
];

export const PIPE_URL = "https://github.com/vnmoorthy/parallax/blob/main/pipelines/parallax-analyst.pipe";

export function PipelineGraph({ run, className, height = 380 }: { run: Run; className?: string; height?: number }) {
  const onCloud = run.modes?.llm === "rocketride";
  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-text"><Network className="size-4 text-accent" /> RocketRide pipeline</div>
          <div className="mono mt-0.5 text-[11px] text-faint">pipelines/parallax-analyst.pipe</div>
        </div>
        <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", onCloud ? "border-success/40 bg-success/10 text-success" : "border-accent/40 bg-accent/10 text-accent-2")}>
          <Cloud className="size-3.5" />
          {onCloud ? "Runs on RocketRide Cloud" : "RocketRide-ready · .pipe in repo"}
          {onCloud && <span className="size-1.5 rounded-full bg-success animate-pulse" />}
        </span>
        <a href={PIPE_URL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:border-border-strong hover:text-text transition-colors">
          <ExternalLink className="size-3" /> view .pipe
        </a>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-elev/50" style={{ height }}>
        <ReactFlow
          nodes={NODES}
          edges={EDGES}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.3}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          className="!bg-transparent"
          style={{ "--xy-background-color": "transparent" } as React.CSSProperties}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.08)" />
        </ReactFlow>
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-3 rounded-md bg-bg/60 px-2 py-1 text-[10px] text-faint backdrop-blur">
          <span className="inline-flex items-center gap-1"><span className="h-px w-4 bg-accent" />data flow</span>
          <span className="inline-flex items-center gap-1"><span className="h-px w-4 border-t border-dashed border-accent-2" />control</span>
        </div>
      </div>

      <div className="grid gap-2 text-[11px] text-muted sm:grid-cols-3">
        <div className="card-2 p-2.5"><div className="mb-0.5 font-semibold text-text">Analyst agent</div>Hypothesis-driven analysis over the forked Hotdata branch; up to 12 tool waves per question.</div>
        <div className="card-2 p-2.5"><div className="mb-0.5 font-semibold text-text">Tools</div><span className="mono text-accent-2">db_hotdata_1</span> runs read-only SQL on table <span className="mono">data</span>; <span className="mono text-accent-2">tool_cognee_1</span> recalls prior investigations.</div>
        <div className="card-2 p-2.5"><div className="mb-0.5 font-semibold text-text">This run</div>LLM route <span className="mono text-text">{String(run.modes?.llm ?? "—")}</span> · data <span className="mono text-text">{run.modes?.data}</span> · memory <span className="mono text-text">{run.modes?.memory}</span>.</div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-faint"><Database className="size-3" /> Only <span className="mono">${"{ROCKETRIDE_*}"}</span> placeholders are substituted at deploy time; no secrets live in the repo.</div>
    </div>
  );
}
