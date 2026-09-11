"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number | string;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "underline" | "pills";
  size?: "sm" | "md";
  /** Stretch tabs to fill the row */
  fitted?: boolean;
  /** Shared id prefix — pass the same to TabPanel for aria linkage */
  idPrefix?: string;
  className?: string;
  "aria-label"?: string;
}

/** Controlled, keyboard-navigable tab list (arrow keys, Home/End). Render content with <TabPanel>. */
export function Tabs<T extends string>({
  tabs, value, onChange, variant = "underline", size = "md", fitted, idPrefix = "tabs", className, ...rest
}: TabsProps<T>) {
  const refs = React.useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, current: T) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.value === current);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    refs.current[target.value]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={rest["aria-label"]}
      aria-orientation="horizontal"
      className={cn(
        "flex items-center gap-1 overflow-x-auto scrollbar-thin",
        variant === "underline" && "border-b",
        variant === "pills" && "rounded-xl border bg-surface/60 p-1",
        fitted && "w-full",
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[t.value] = el; }}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${t.value}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${t.value}`}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, t.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-accent-2/80 disabled:opacity-40 [&_svg]:size-4",
              size === "sm" ? "text-xs" : "text-sm",
              fitted && "flex-1",
              variant === "underline" && cn(
                "-mb-px rounded-t-lg border-b-2 px-3",
                size === "sm" ? "py-1.5" : "py-2.5",
                active ? "border-accent-2 text-text" : "border-transparent text-muted hover:border-border-strong hover:text-text",
              ),
              variant === "pills" && cn(
                "rounded-lg px-3",
                size === "sm" ? "py-1" : "py-1.5",
                active ? "bg-surface-3 text-text shadow-sm" : "text-muted hover:text-text",
              ),
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <span className={cn("tabular rounded-full px-1.5 py-px text-[10px]", active ? "bg-accent/20 text-[#c7d2fe]" : "bg-white/6 text-faint")}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  active: boolean;
  idPrefix?: string;
  /** Keep mounted (hidden) when inactive */
  keepMounted?: boolean;
}

export function TabPanel({ value, active, idPrefix = "tabs", keepMounted, className, children, ...props }: TabPanelProps) {
  if (!active && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      hidden={!active}
      tabIndex={0}
      className={cn("outline-hidden", className)}
      {...props}
    >
      {children}
    </div>
  );
}
