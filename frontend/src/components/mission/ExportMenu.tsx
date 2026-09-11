"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, FileText, Link2, Loader2, RotateCcw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { Run } from "@/lib/types";
import { api } from "@/lib/api";

/** Clipboard helper with toast feedback. Falls back to a hidden textarea when the async API is unavailable. */
export async function copyText(text: string, label = "Copied"): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
    if (label) toast.success(label);
    return true;
  } catch (e) {
    toast.error(`Copy failed: ${(e as Error).message}`);
    return false;
  }
}

/** Small icon button that copies `text` and flashes a check. */
export function CopyButton({ text, label = "Copied", className, title = "Copy", size = 3.5 }: { text: string; label?: string; className?: string; title?: string; size?: number }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => { e.stopPropagation(); if (await copyText(text, label)) { setOk(true); setTimeout(() => setOk(false), 1200); } }}
      className={clsx("inline-flex items-center justify-center rounded-md p-1 text-faint hover:text-text hover:bg-white/5 transition-colors", className)}
      title={title}
      aria-label={title}
    >
      {ok ? <Check style={{ width: size * 4, height: size * 4 }} className="text-success" /> : <Copy style={{ width: size * 4, height: size * 4 }} />}
    </button>
  );
}

export function ExportMenu({ run, className }: { run: Run; className?: string }) {
  const [open, setOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const hasReport = !!run.report;

  const items: { key: string; label: string; hint?: string; Icon: React.ComponentType<{ className?: string }>; disabled?: boolean; onClick: () => void | Promise<unknown> }[] = [
    {
      key: "download", label: "Download report.md", hint: hasReport ? "text/markdown" : "available after synthesis", Icon: Download, disabled: !hasReport,
      onClick: () => { window.open(api.reportUrl(run.id), "_blank", "noopener"); toast.success("Downloading report.md"); },
    },
    {
      key: "share", label: "Copy share link", hint: "current URL", Icon: Link2,
      onClick: () => copyText(window.location.href, "Share link copied"),
    },
    {
      key: "md", label: "Copy report markdown", hint: hasReport ? `${run.report!.markdown.length.toLocaleString()} chars` : "available after synthesis", Icon: FileText, disabled: !hasReport,
      onClick: () => copyText(run.report!.markdown, "Report markdown copied"),
    },
    {
      key: "rerun", label: rerunning ? "Launching…" : "Re-run", hint: `${run.agents} agents · same question`, Icon: rerunning ? Loader2 : RotateCcw, disabled: rerunning,
      onClick: async () => {
        setRerunning(true);
        try {
          const { run_id } = await api.createRun({ dataset_id: run.dataset_id, question: run.question, agents: run.agents });
          toast.success("Swarm relaunched");
          setOpen(false);
          router.push(`/runs/${run_id}`);
        } catch (e) { toast.error((e as Error).message); }
        finally { setRerunning(false); }
      },
    },
  ];

  return (
    <div ref={ref} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx("inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 transition-colors", open && "bg-surface-3")}
        aria-haspopup="menu" aria-expanded={open}
      >
        <Share2 className="size-3.5" /> Export
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.12 }}
            className="absolute right-0 z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-border-strong bg-surface-2 shadow-2xl shadow-black/50"
          >
            {items.map((it) => (
              <button
                key={it.key} role="menuitem" type="button" disabled={it.disabled}
                onClick={() => { void it.onClick(); if (it.key !== "rerun") setOpen(false); }}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <it.Icon className={clsx("mt-0.5 size-3.5 text-accent-2", it.key === "rerun" && rerunning && "animate-spin")} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-text">{it.label}</span>
                  {it.hint && <span className="block text-[10px] text-faint">{it.hint}</span>}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
