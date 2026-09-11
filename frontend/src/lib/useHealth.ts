"use client";
// Shared, visibility-aware poller for GET /api/health. Every hook instance subscribes to one
// module-level store so Nav, Settings and the Launch page never issue duplicate requests.
import { useCallback, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Health } from "./types";
import { errorMessage } from "./utils";

export interface HealthState {
  health: Health | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

const POLL_MS = 15_000;
const initial: HealthState = { health: null, error: null, loading: true, updatedAt: null };

let state: HealthState = initial;
const listeners = new Set<() => void>();
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function emit() { for (const l of listeners) l(); }
function setState(patch: Partial<HealthState>) { state = { ...state, ...patch }; emit(); }

/** Fetch health now (deduplicated). Safe to call from anywhere on the client. */
export function refreshHealth(): Promise<void> {
  if (inflight) return inflight;
  inflight = api.health()
    .then((h) => setState({ health: h, error: null, loading: false, updatedAt: Date.now() }))
    .catch((e: unknown) => setState({ health: null, error: errorMessage(e, "Backend unreachable"), loading: false, updatedAt: Date.now() }))
    .finally(() => { inflight = null; });
  return inflight;
}

function visible() { return typeof document === "undefined" || document.visibilityState === "visible"; }
function startTimer() { stopTimer(); timer = setInterval(() => { if (visible()) void refreshHealth(); }, POLL_MS); }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function onVisibility() { if (visible()) { void refreshHealth(); startTimer(); } else stopTimer(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    void refreshHealth();
    startTimer();
    document.addEventListener("visibilitychange", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) {
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
const getSnapshot = () => state;
const getServerSnapshot = () => initial;

/** Live backend health, polled every 15s while the tab is visible. */
export function useHealth() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const refresh = useCallback(() => refreshHealth(), []);
  return {
    health: s.health,
    error: s.error,
    loading: s.loading,
    updatedAt: s.updatedAt,
    /** true once we know the backend is unreachable */
    offline: !s.loading && s.health === null,
    refresh,
  };
}
