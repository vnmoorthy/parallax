"use client";
import * as React from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Dataset } from "@/lib/types";
import { cn, errorMessage } from "@/lib/utils";
import { formatBytes, formatNumber } from "@/lib/format";
import { Progress } from "./ui/Progress";

const MAX_BYTES = 25 * 1024 * 1024;

export interface UploadDropzoneProps {
  onUploaded: (dataset: Dataset) => void;
  className?: string;
}

function validate(file: File): string | null {
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
  if (!isCsv) return "Only .csv files are supported.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return `File is ${formatBytes(file.size)} — the limit is 25 MB.`;
  return null;
}

export function UploadDropzone({ onUploaded, className }: UploadDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ticker = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => () => { if (ticker.current) clearInterval(ticker.current); }, []);

  const handle = async (file: File) => {
    const problem = validate(file);
    if (problem) {
      setError(problem);
      toast.error("Can't upload that file", { description: problem });
      return;
    }
    setError(null);
    setFileName(file.name);
    setUploading(true);
    setProgress(4);
    // fetch() has no upload progress; ease toward 90% while the request is in flight.
    ticker.current = setInterval(() => setProgress((p) => (p < 90 ? p + (90 - p) * 0.08 : p)), 180);
    try {
      const ds = await api.uploadDataset(file);
      setProgress(100);
      toast.success(`Uploaded ${ds.name}`, { description: `${formatNumber(ds.rows)} rows · ${ds.columns.length} columns` });
      onUploaded(ds);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("Upload failed", { description: msg });
    } finally {
      if (ticker.current) { clearInterval(ticker.current); ticker.current = null; }
      setTimeout(() => { setUploading(false); setProgress(0); }, 600);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const openPicker = () => { if (!uploading) inputRef.current?.click(); };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a CSV dataset (drag and drop or click to browse, up to 25 MB)"
      aria-busy={uploading || undefined}
      onClick={openPicker}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!uploading) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (uploading) return;
        const file = e.dataTransfer.files?.[0];
        if (file) void handle(file);
      }}
      className={cn(
        "card group relative flex h-full min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 border-dashed p-6 text-center outline-hidden transition-[border-color,background-color,box-shadow] duration-200",
        "hover:border-border-strong hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-accent-2/70",
        drag && "border-accent-2 bg-accent-2/5 shadow-[0_0_0_4px_rgba(34,211,238,.12)]",
        uploading && "cursor-progress",
        error && !uploading && "border-danger/40",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); }}
      />
      <span
        className={cn(
          "inline-flex size-12 items-center justify-center rounded-2xl border transition-colors",
          drag ? "border-accent-2/60 bg-accent-2/15 text-accent-2" : "border-border-strong bg-surface-2 text-muted group-hover:text-text",
        )}
        aria-hidden
      >
        {uploading ? <FileSpreadsheet className="size-5" /> : <UploadCloud className="size-5" />}
      </span>
      {uploading ? (
        <div className="w-full max-w-xs">
          <div className="mono truncate text-sm text-text">{fileName}</div>
          <Progress value={progress} className="mt-2" label="Upload progress" />
          <div className="tabular mt-1.5 text-xs text-muted">{progress >= 100 ? "Profiling…" : `Uploading… ${Math.round(progress)}%`}</div>
        </div>
      ) : (
        <div>
          <div className="text-sm font-semibold text-text">{drag ? "Drop to upload" : "Upload a CSV"}</div>
          <div className="mt-1 text-xs text-muted">Drag &amp; drop or click to browse · up to 25 MB</div>
          {error ? (
            <div role="alert" className="mt-2 text-xs text-danger">{error}</div>
          ) : (
            <div className="mt-2 text-[11px] text-faint">Free-text columns get BM25 + vector indexes automatically</div>
          )}
        </div>
      )}
    </div>
  );
}
