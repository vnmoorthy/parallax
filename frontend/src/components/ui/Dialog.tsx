"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsClient } from "@/lib/hooks";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const sizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[96vw]",
} as const;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof sizes;
  hideClose?: boolean;
  className?: string;
  bodyClassName?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/** Accessible modal dialog: portal, focus trap, Esc/overlay to close, scroll lock, focus restore. */
export function Dialog({
  open, onClose, title, description, children, footer, size = "md", hideClose, className, bodyClassName, initialFocusRef,
}: DialogProps) {
  const mounted = useIsClient();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.classList.add("no-scroll");

    const focusFirst = () => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        panelRef.current;
      target?.focus({ preventScroll: true });
    };
    const t = setTimeout(focusFirst, 20);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, initialFocusRef]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={cn("card-2 relative flex max-h-[90vh] w-full flex-col overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] outline-hidden", sizes[size], className)}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {(title || !hideClose) && (
              <div className="flex items-start gap-4 border-b px-5 py-4">
                <div className="min-w-0 flex-1">
                  {title && <h2 id={titleId} className="text-base font-semibold tracking-tight text-text">{title}</h2>}
                  {description && <p id={descId} className="mt-1 text-sm text-muted">{description}</p>}
                </div>
                {!hideClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted outline-hidden transition-colors hover:bg-white/5 hover:text-text focus-visible:ring-2 focus-visible:ring-accent-2/80"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            )}
            {children && <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin", bodyClassName)}>{children}</div>}
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-surface/40 px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
