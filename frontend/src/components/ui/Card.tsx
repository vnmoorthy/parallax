import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hover affordance for clickable cards */
  interactive?: boolean;
  /** Use the lighter `surface-2` background */
  elevated?: boolean;
  /** Frosted-glass treatment */
  glass?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const pad = { none: "", sm: "p-4", md: "p-5", lg: "p-6 sm:p-8" } as const;

export function Card({ className, interactive, elevated, glass, padding = "md", ...props }: CardProps) {
  return (
    <div
      className={cn(
        elevated ? "card-2" : "card",
        glass && "glass",
        pad[padding],
        interactive &&
          "transition-[border-color,box-shadow,translate] duration-200 hover:border-border-strong hover:shadow-[0_18px_50px_-24px_rgba(0,0,0,.8)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold tracking-tight text-text", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex items-center gap-2 border-t pt-4", className)} {...props} />;
}
