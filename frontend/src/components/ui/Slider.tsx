"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  showValue?: boolean;
  formatValue?: (v: number) => string;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Slider({
  value, onChange, min = 0, max = 100, step = 1, label, hint, showValue = true, formatValue, id, className, disabled, ...aria
}: SliderProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const display = formatValue ? formatValue(value) : String(value);
  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {label ? <label htmlFor={inputId} className="text-sm font-medium text-text">{label}</label> : <span />}
          {showValue && (
            <output htmlFor={inputId} className="mono tabular rounded-md border border-border-strong bg-surface-2 px-2 py-0.5 text-xs text-text">
              {display}
            </output>
          )}
        </div>
      )}
      <input
        id={inputId}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
        aria-valuetext={display}
        aria-label={aria["aria-label"]}
      />
      <div className="tabular mt-1.5 flex justify-between text-[11px] text-faint" aria-hidden>
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
