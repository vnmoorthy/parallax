import { cn } from "@/lib/utils";

/** Parallax mark: many branches converging on one answer. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id="plx-logo-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#0e1220" stroke="url(#plx-logo-g)" strokeWidth="2" />
      <path d="M15 17 L49 32 L15 47" stroke="url(#plx-logo-g)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".45" />
      <path d="M15 25 L49 32 L15 39" stroke="url(#plx-logo-g)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".8" />
      <path d="M15 32 H49" stroke="#e6e9f2" strokeWidth="4" strokeLinecap="round" />
      <circle cx="49" cy="32" r="5.5" fill="#22d3ee" />
    </svg>
  );
}

export function LogoLockup({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo size={size} />
      <span className="text-[15px] font-semibold tracking-tight text-text">Parallax</span>
    </span>
  );
}
