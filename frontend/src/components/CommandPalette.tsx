"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Brain, ExternalLink, History, Rocket, Search, Settings } from "lucide-react";
import { api } from "@/lib/api";
import type { RunSummary } from "@/lib/types";
import { cn, GITHUB_URL } from "@/lib/utils";
import { useIsClient } from "@/lib/hooks";
import { relativeTime, truncate } from "@/lib/format";
import { Kbd } from "./ui/Kbd";
import { Skeleton } from "./ui/Skeleton";
import { statusTone } from "./ui/Badge";

const OPEN_EVENT = "parallax:command-palette";

/** Toggle the palette from anywhere (Nav button, etc). */
export function openCommandPalette() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

const dotTone: Record<string, string> = {
  success: "bg-success", danger: "bg-danger", cyan: "bg-accent-2", info: "bg-info", accent: "bg-accent", warn: "bg-warn", neutral: "bg-faint",
};

export function CommandPalette() {
  const router = useRouter();
  const mounted = useIsClient();
  const [open, setOpen] = React.useState(false);
  const [runs, setRuns] = React.useState<RunSummary[] | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onToggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onToggle);
    };
  }, []);

  // The palette unmounts when closed, so cmdk's input/selection reset for free; runs are
  // revalidated on every open (stale list stays visible while the refresh is in flight).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.runs()
      .then((r) => { if (!cancelled) setRuns(r.slice(0, 8)); })
      .catch(() => { if (!cancelled) setRuns((prev) => prev ?? []); });
    document.body.classList.add("no-scroll");
    return () => { cancelled = true; document.body.classList.remove("no-scroll"); };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);
  const go = React.useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  const actions = React.useMemo(() => [
    { id: "launch", label: "Launch a run", hint: "/", icon: <Rocket />, run: () => go("/") },
    { id: "runs", label: "View runs", hint: "/runs", icon: <History />, run: () => go("/runs") },
    { id: "memory", label: "Memory", hint: "/memory", icon: <Brain />, run: () => go("/memory") },
    { id: "settings", label: "Settings", hint: "/settings", icon: <Settings />, run: () => go("/settings") },
    { id: "github", label: "Open GitHub", hint: "github.com", icon: <ExternalLink />, run: () => { setOpen(false); window.open(GITHUB_URL, "_blank", "noopener,noreferrer"); } },
  ], [go]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            onClick={close}
            aria-hidden
          />
          <motion.div
            className="card-2 relative w-full max-w-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]"
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
          >
            <Command label="Command palette" loop>
              <div className="flex items-center gap-2.5 border-b px-3.5">
                <Search className="size-4 shrink-0 text-faint" aria-hidden />
                <Command.Input
                  autoFocus
                  placeholder="Type a command or search runs…"
                  className="h-12 w-full bg-transparent text-sm text-text outline-hidden placeholder:text-faint"
                />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2 scrollbar-thin">
                <Command.Empty className="px-3 py-10 text-center text-sm text-faint">No matches.</Command.Empty>
                <Command.Group heading="Actions">
                  {actions.map((a) => (
                    <Command.Item key={a.id} value={`${a.label} ${a.hint}`} onSelect={a.run}>
                      {a.icon}
                      <span className="flex-1">{a.label}</span>
                      <span className="mono text-[11px] text-faint">{a.hint}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Recent runs">
                  {runs === null ? (
                    <div className="space-y-1.5 px-2 py-1.5" aria-busy="true">
                      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  ) : runs && runs.length > 0 ? (
                    runs.map((r) => (
                      <Command.Item key={r.id} value={`${r.question} ${r.dataset_name} ${r.id}`} onSelect={() => go(`/runs/${r.id}`)}>
                        <span className={cn("size-2 shrink-0 rounded-full", dotTone[statusTone(r.status)])} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{truncate(r.question, 70)}</span>
                        <span className="shrink-0 text-[11px] text-faint">{r.dataset_name} · {relativeTime(r.created_at)}</span>
                        <ArrowRight className="!size-3.5 shrink-0 opacity-0 transition-opacity group-data-[selected=true]:opacity-100" aria-hidden />
                      </Command.Item>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs text-faint">No runs yet — launch one from the home page.</div>
                  )}
                </Command.Group>
              </Command.List>
              <div className="flex items-center gap-3 border-t bg-surface/40 px-3.5 py-2 text-[11px] text-faint">
                <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
                <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
                <span className="inline-flex items-center gap-1"><Kbd>esc</Kbd> close</span>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
