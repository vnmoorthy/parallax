import * as React from "react";
import { cn } from "@/lib/utils";

export type TooltipSide = "top" | "bottom" | "left" | "right";

const sides: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2 origin-bottom",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2 origin-top",
  left: "right-full top-1/2 mr-2 -translate-y-1/2 origin-right",
  right: "left-full top-1/2 ml-2 -translate-y-1/2 origin-left",
};

export interface TooltipProps {
  content: React.ReactNode;
  side?: TooltipSide;
  children: React.ReactNode;
  className?: string;
  wrapperClassName?: string;
  disabled?: boolean;
}

/** Lightweight CSS tooltip (hover + focus-within). No portal, so keep it away from overflow-hidden parents. */
export function Tooltip({ content, side = "top", children, className, wrapperClassName, disabled }: TooltipProps) {
  const id = React.useId();
  if (disabled || content == null || content === "") return <>{children}</>;
  return (
    <span className={cn("group/tt relative inline-flex", wrapperClassName)}>
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute z-50 w-max max-w-[260px] rounded-lg border border-border-strong bg-surface-3 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-text shadow-xl",
          "scale-95 opacity-0 transition-[opacity,scale] duration-150",
          "group-hover/tt:scale-100 group-hover/tt:opacity-100 group-focus-within/tt:scale-100 group-focus-within/tt:opacity-100",
          sides[side],
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
