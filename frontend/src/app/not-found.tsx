import { Compass, History, Rocket } from "lucide-react";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="relative mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative">
        <Logo size={56} className="mx-auto opacity-90" />
        <div className="mono mt-6 text-xs uppercase tracking-[0.2em] text-accent-2">404 · branch not found</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text sm:text-4xl">This branch was never forked.</h1>
        <p className="mt-3 text-sm text-muted sm:text-base">
          The page you’re looking for doesn’t exist — maybe the run was deleted, or the link is a hypothesis that didn’t pan out.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <LinkButton href="/" variant="primary" icon={<Rocket />}>Launch a run</LinkButton>
          <LinkButton href="/runs" icon={<History />}>View run history</LinkButton>
        </div>
        <div className="mt-8 inline-flex items-center gap-2 text-xs text-faint">
          <Compass className="size-3.5" aria-hidden /> Tip: press <kbd className="mono rounded border border-border-strong bg-surface-2 px-1">⌘K</kbd> to jump anywhere.
        </div>
      </div>
    </div>
  );
}
