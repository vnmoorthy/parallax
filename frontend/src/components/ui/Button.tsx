"use client";
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const base =
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap select-none " +
  "transition-[background-color,border-color,box-shadow,color,opacity,filter,scale] duration-150 outline-hidden " +
  "focus-visible:ring-2 focus-visible:ring-accent-2/80 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

const variants: Record<ButtonVariant, string> = {
  primary:
    "text-[#07090f] bg-linear-to-r from-[#818cf8] via-[#5eaef8] to-[#67e8f9] " +
    "shadow-[0_10px_30px_-10px_var(--accent-glow),inset_0_1px_0_rgba(255,255,255,.35)] " +
    "hover:brightness-110 hover:shadow-[0_14px_36px_-10px_var(--accent-glow),inset_0_1px_0_rgba(255,255,255,.35)]",
  secondary: "bg-surface-2 text-text border border-border-strong hover:bg-surface-3 hover:border-white/20",
  ghost: "text-muted hover:text-text hover:bg-white/5",
  danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 hover:border-danger/50",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
  md: "h-10 px-4 text-sm [&_svg]:size-4",
  lg: "h-12 px-6 text-base [&_svg]:size-5",
  icon: "size-10 p-0 [&_svg]:size-4",
  "icon-sm": "size-8 p-0 [&_svg]:size-4",
};

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export function buttonClasses({
  variant = "secondary",
  size = "md",
  fullWidth,
  className,
}: Pick<ButtonProps, "variant" | "size" | "fullWidth" | "className"> = {}): string {
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconRight,
  fullWidth,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={size === "lg" ? 18 : 14} /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
}

export interface LinkButtonProps extends Omit<React.ComponentProps<typeof Link>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  className?: string;
}

/** next/link styled exactly like a Button. */
export function LinkButton({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  fullWidth,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth, className })} {...props}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}
