import { GITHUB_URL } from "@/lib/utils";

const sponsors = [
  { name: "RocketRide", href: "https://rocketride.org" },
  { name: "Hotdata", href: "https://hotdata.dev" },
  { name: "Cognee", href: "https://cognee.ai" },
  { name: "Snyk", href: "https://snyk.io" },
];

export function Footer() {
  return (
    <footer className="mt-20 border-t border-border/80">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-faint sm:flex-row sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
          <span>Built with</span>
          {sponsors.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded text-muted transition-colors hover:text-text"
              >
                {s.name}
              </a>
              {i < sponsors.length - 1 && <span aria-hidden>·</span>}
            </span>
          ))}
        </p>
        <p className="flex items-center gap-3">
          <span>Built at the Data &amp; AI Hackathon, SF · Sept 11, 2026</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="rounded text-muted transition-colors hover:text-text">
            Source
          </a>
        </p>
      </div>
    </footer>
  );
}
