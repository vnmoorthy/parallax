"use client";
import { useSyncExternalStore } from "react";
import { isMac } from "./utils";

const noopSubscribe = () => () => {};

/** false during SSR/hydration, true after mount — without a setState-in-effect. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Platform-aware modifier key (⌘ vs Ctrl); true on the server so markup is stable. */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, isMac, () => true);
}
