"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Search, X } from "lucide-react";
import { cn, GITHUB_URL } from "@/lib/utils";
import { useIsMac } from "@/lib/hooks";
import { Logo } from "./Logo";
import { ModeBadges } from "./ModeBadges";
import { Kbd } from "./ui/Kbd";
import { openCommandPalette } from "./CommandPalette";

const links = [
  { href: "/", label: "Launch" },
  { href: "/runs", label: "Runs" },
  { href: "/memory", label: "Memory" },
  { href: "/settings", label: "Settings" },
];

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const mac = useIsMac();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-accent-2/80"
          aria-label="Parallax — home"
        >
          <Logo size={26} />
          <span className="text-[15px] font-semibold tracking-tight text-text">Parallax</span>
        </Link>

        <nav aria-label="Primary" className="ml-2 hidden items-center gap-0.5 md:flex">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-accent-2/80",
                  active ? "text-text" : "text-muted hover:bg-white/4 hover:text-text",
                )}
              >
                {l.label}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-lg bg-white/6 ring-1 ring-white/8"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ModeBadges compact className="hidden lg:block" />
          <button
            type="button"
            onClick={() => openCommandPalette()}
            className="hidden h-8 items-center gap-2 rounded-lg border border-border bg-surface/60 px-2.5 text-xs text-muted outline-hidden transition-colors hover:border-border-strong hover:text-text focus-visible:ring-2 focus-visible:ring-accent-2/80 sm:inline-flex"
            aria-label="Open command palette"
            aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
          >
            <Search className="size-3.5" aria-hidden />
            <span className="hidden md:inline">Search…</span>
            <span className="flex items-center gap-1">
              <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Parallax on GitHub"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted outline-hidden transition-colors hover:bg-white/5 hover:text-text focus-visible:ring-2 focus-visible:ring-accent-2/80"
          >
            <GitHubIcon className="size-4" />
          </a>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted outline-hidden transition-colors hover:bg-white/5 hover:text-text focus-visible:ring-2 focus-visible:ring-accent-2/80 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close navigation" : "Open navigation"}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="mobile-nav"
            className="overflow-hidden border-t border-border/80 bg-bg/95 md:hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-4 py-3">
              {links.map((l) => {
                const active = isActive(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn("rounded-lg px-3 py-2 text-sm", active ? "bg-white/6 text-text" : "text-muted hover:bg-white/4 hover:text-text")}
                  >
                    {l.label}
                  </Link>
                );
              })}
              <div className="mt-2 border-t pt-3">
                <ModeBadges />
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
