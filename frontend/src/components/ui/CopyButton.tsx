"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/utils";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

export interface CopyButtonProps {
  text: string | (() => string);
  label?: string;
  copiedLabel?: string;
  size?: Extract<ButtonSize, "sm" | "md">;
  variant?: ButtonVariant;
  iconOnly?: boolean;
  /** Toast shown on success; pass null to disable */
  toastMessage?: string | null;
  className?: string;
}

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  size = "sm",
  variant = "ghost",
  iconOnly,
  toastMessage = "Copied to clipboard",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onCopy = async () => {
    const value = typeof text === "function" ? text() : text;
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      if (toastMessage) toast.success(toastMessage);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error("Couldn't copy — clipboard unavailable");
    }
  };

  return (
    <Button
      size={iconOnly ? (size === "sm" ? "icon-sm" : "icon") : size}
      variant={variant}
      onClick={onCopy}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
      aria-live="polite"
      icon={copied ? <Check className="text-success" /> : <Copy />}
      className={className}
    >
      {iconOnly ? null : copied ? copiedLabel : label}
    </Button>
  );
}
