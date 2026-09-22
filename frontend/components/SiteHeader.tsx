import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="bg-header text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-8">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-bold uppercase tracking-tight">
            Cap<span className="text-accent">Value</span>
          </span>
          <span className="hidden font-mono text-[11px] uppercase tracking-wide text-white/40 sm:inline">
            NFL Contract Analytics
          </span>
        </Link>
        <nav className="flex items-center gap-6 font-display text-sm font-semibold uppercase tracking-wide text-white/70">
          <Link href="/" className="hover:text-white">
            Dashboard
          </Link>
          <Link href="/#methodology" className="hover:text-white">
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}
