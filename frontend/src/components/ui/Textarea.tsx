"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClasses, invalidClasses } from "./Input";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  invalid?: boolean;
  /** Grow with content (up to maxHeight px) */
  autoResize?: boolean;
  maxHeight?: number;
}

export function Textarea({ invalid, autoResize, maxHeight = 320, className, ref, value, ...props }: TextareaProps) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = node;
    },
    [ref],
  );

  React.useEffect(() => {
    if (!autoResize || !inner.current) return;
    const el = inner.current;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, autoResize, maxHeight]);

  return (
    <textarea
      ref={setRef}
      value={value}
      className={cn(fieldClasses, "min-h-[96px] resize-y px-3 py-2.5 leading-relaxed scrollbar-thin", autoResize && "resize-none overflow-auto", invalid && invalidClasses, className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}
