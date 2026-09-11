"use client";
import * as React from "react";
import { Toaster } from "sonner";
import { MotionConfig } from "framer-motion";
import { CommandPalette } from "@/components/CommandPalette";
import { installMock } from "@/lib/mock";

const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

// Patch the API client before any component effect can fire. Module scope runs once per page load in
// the browser (guarded so SSR never touches it); installMock() itself is idempotent.
if (MOCK && typeof window !== "undefined") installMock();

export function Providers({ children }: { children: React.ReactNode }) {
  // Belt and braces for the first client render (e.g. if this module is evaluated lazily).
  React.useState(() => {
    if (MOCK && typeof window !== "undefined") installMock();
    return true;
  });

  return (
    <MotionConfig reducedMotion="user">
      {children}
      <CommandPalette />
      <Toaster
        theme="dark"
        richColors
        closeButton
        position="bottom-right"
        toastOptions={{ style: { fontFamily: "var(--font-sans)" } }}
      />
    </MotionConfig>
  );
}
