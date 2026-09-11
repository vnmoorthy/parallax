"use client";
import * as React from "react";
import { AlertOctagon, Home, RefreshCw } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/Button";

export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  React.useEffect(() => { console.error(error); }, [error]);
  const again = retry ?? reset;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center" role="alert">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10 text-danger" aria-hidden>
        <AlertOctagon className="size-6" />
      </span>
      <div className="mono mt-6 text-xs uppercase tracking-[0.2em] text-danger">Run failed to render</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text">Something went sideways.</h1>
      <p className="mt-3 text-sm text-muted sm:text-base">{error.message || "An unexpected error occurred while rendering this page."}</p>
      {error.digest && <p className="mono mt-2 text-[11px] text-faint">digest: {error.digest}</p>}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {again && <Button variant="primary" icon={<RefreshCw />} onClick={() => again()}>Try again</Button>}
        <LinkButton href="/" icon={<Home />}>Back to Launch</LinkButton>
      </div>
    </div>
  );
}
