import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with clsx semantics and tailwind-merge conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const GITHUB_URL = "https://github.com/vnmoorthy/parallax";

/** True on Apple platforms (used to render ⌘ vs Ctrl). Safe on the server (defaults to true). */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return true;
  const p = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

/** Copy text to the clipboard with a legacy fallback. Resolves true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}


export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Extract a human-readable message from any thrown value. */
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return fallback;
}
