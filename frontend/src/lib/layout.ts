// Tree layout for the lineage graph (React Flow). Pure + framework-free so it can be unit-tested.
// layoutTree(nodes) → Map<id, {x, y}>; root(s) top-center, children evenly spaced, parents centered over
// their subtree. Works for arbitrary depth (root → fork → fork-of-fork …).

export interface TreeInput { id: string; parent_id?: string | null }
export interface Point { x: number; y: number }
export interface LayoutOptions {
  /** "tree" (default): root top-center, siblings fanned horizontally. "stack": git-graph style vertical list, children indented — for narrow containers. */
  mode?: "tree" | "stack";
  siblingGap?: number;
  levelHeight?: number;
  /** stack mode: horizontal indent per depth level */
  indent?: number;
  /** stack mode: vertical distance between consecutive rows */
  rowHeight?: number;
}

export const SIBLING_GAP = 260;
export const LEVEL_HEIGHT = 170;
export const STACK_INDENT = 28;
export const STACK_ROW = 104;

export function layoutTree(nodes: TreeInput[], opts: LayoutOptions = {}): Map<string, Point> {
  const gap = opts.siblingGap ?? SIBLING_GAP;
  const levelH = opts.levelHeight ?? LEVEL_HEIGHT;
  const out = new Map<string, Point>();
  if (!nodes.length) return out;
  if (opts.mode === "stack") return layoutStack(nodes, opts.indent ?? STACK_INDENT, opts.rowHeight ?? STACK_ROW);

  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    if (children.has(n.id)) continue; // ignore duplicate ids, first wins
    children.set(n.id, []);
  }
  for (const n of nodes) {
    const pid = n.parent_id ?? null;
    if (pid && ids.has(pid) && pid !== n.id) children.get(pid)!.push(n.id);
    else roots.push(n.id);
  }
  // de-dupe roots (duplicate ids) while preserving order
  const seenRoot = new Set<string>();
  const uniqRoots = roots.filter((r) => (seenRoot.has(r) ? false : (seenRoot.add(r), true)));

  const visiting = new Set<string>();
  const widthMemo = new Map<string, number>();
  const leafWidth = (id: string): number => {
    if (widthMemo.has(id)) return widthMemo.get(id)!;
    if (visiting.has(id)) return 1; // cycle guard
    visiting.add(id);
    const kids = children.get(id) ?? [];
    const w = kids.length ? kids.reduce((acc, k) => acc + leafWidth(k), 0) : 1;
    visiting.delete(id);
    widthMemo.set(id, Math.max(1, w));
    return widthMemo.get(id)!;
  };

  const placed = new Set<string>();
  const place = (id: string, depth: number, leftSlot: number): number => {
    if (placed.has(id)) return leftSlot;
    placed.add(id);
    const kids = children.get(id) ?? [];
    const y = depth * levelH;
    if (!kids.length) {
      out.set(id, { x: (leftSlot + 0.5) * gap, y });
      return leftSlot + 1;
    }
    let cursor = leftSlot;
    const xs: number[] = [];
    for (const k of kids) {
      const kw = leafWidth(k);
      const start = cursor;
      cursor = place(k, depth + 1, cursor);
      const p = out.get(k);
      xs.push(p ? p.x : (start + kw / 2) * gap);
    }
    const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (leftSlot + 0.5) * gap;
    out.set(id, { x, y });
    return Math.max(cursor, leftSlot + leafWidth(id));
  };

  let slot = 0;
  for (const r of uniqRoots) slot = place(r, 0, slot);
  // any unplaced (cycles) — drop them on a new row
  for (const n of nodes) if (!placed.has(n.id)) slot = place(n.id, 0, slot);

  // center horizontally around x = 0
  let min = Infinity, max = -Infinity;
  for (const p of out.values()) { if (p.x < min) min = p.x; if (p.x > max) max = p.x; }
  const shift = (min + max) / 2;
  for (const [id, p] of out) out.set(id, { x: Math.round(p.x - shift), y: p.y });
  return out;
}

/** DFS vertical stack: every node on its own row, indented by depth. x is the node's LEFT edge offset (not centered). */
function layoutStack(nodes: TreeInput[], indent: number, rowH: number): Map<string, Point> {
  const out = new Map<string, Point>();
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const pid = n.parent_id ?? null;
    if (pid && ids.has(pid) && pid !== n.id) { if (!children.has(pid)) children.set(pid, []); children.get(pid)!.push(n.id); }
    else roots.push(n.id);
  }
  let row = 0;
  const placed = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (placed.has(id)) return;
    placed.add(id);
    out.set(id, { x: depth * indent, y: row * rowH });
    row++;
    for (const c of children.get(id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const n of nodes) if (!placed.has(n.id)) walk(n.id, 0);
  return out;
}

/** Short, human-friendly id (last 6–8 chars) for db/branch ids. */
export function shortId(id: string | null | undefined, n = 8): string {
  if (!id) return "—";
  const clean = id.replace(/^(db|branch|b|run)[-_]/i, "");
  return clean.length <= n ? clean : clean.slice(-n);
}
