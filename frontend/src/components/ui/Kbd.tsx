import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-1.5 font-mono text-[10px] font-medium leading-none text-muted shadow-[inset_0_-1px_0_rgba(255,255,255,.08)]",
        className,
      )}
      {...props}
    />
  );
}
