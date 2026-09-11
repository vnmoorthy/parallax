import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared field chrome used by Input, Textarea and Select. */
export const fieldClasses =
  "w-full rounded-xl border border-border-strong bg-bg-elev/70 text-sm text-text placeholder:text-faint " +
  "transition-[border-color,box-shadow,background-color] duration-150 outline-hidden " +
  "hover:border-white/20 focus:border-accent/70 focus:ring-2 focus:ring-accent/25 focus:bg-bg-elev " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const invalidClasses = "border-danger/60 focus:border-danger focus:ring-danger/25";

export interface InputProps extends React.ComponentProps<"input"> {
  invalid?: boolean;
  icon?: React.ReactNode;
  inputSize?: "sm" | "md" | "lg";
}

const heights = { sm: "h-8 px-2.5 text-xs", md: "h-10 px-3", lg: "h-12 px-4 text-base" } as const;

export function Input({ invalid, icon, inputSize = "md", className, ...props }: InputProps) {
  const input = (
    <input
      className={cn(fieldClasses, heights[inputSize], icon && "pl-9", invalid && invalidClasses, className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
  if (!icon) return input;
  return (
    <div className="relative w-full">
      <span className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-faint [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      {input}
    </div>
  );
}

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  hint?: React.ReactNode;
  optional?: boolean;
}

export function Label({ className, hint, optional, children, ...props }: LabelProps) {
  return (
    <label className={cn("mb-1.5 flex items-baseline justify-between gap-3 text-sm font-medium text-text", className)} {...props}>
      <span>
        {children}
        {optional && <span className="ml-1.5 text-xs font-normal text-faint">optional</span>}
      </span>
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Hint({ error, className, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { error?: boolean }) {
  return (
    <p
      role={error ? "alert" : undefined}
      className={cn("mt-1.5 text-xs", error ? "text-danger" : "text-muted", className)}
      {...props}
    />
  );
}
