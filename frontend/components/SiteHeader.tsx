"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CommandSearch from "@/components/CommandSearch";

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-header/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4 sm:px-8">
        <Link href="/" className="flex shrink-0 items-baseline gap-2">
          <span className="font-display text-2xl font-bold uppercase tracking-tight text-ink">
            Cap<span className="text-accent">Value</span>
          </span>
          <span className="hidden font-mono text-[11px] uppercase tracking-wide text-ink-faint sm:inline">
            NFL Contract Analytics
          </span>
        </Link>

        <div className="hidden flex-1 justify-center md:flex">
          <CommandSearch variant="nav" />
        </div>

        <nav className="ml-auto flex items-center gap-6 font-display text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
          <Link
            href="/"
            className={pathname === "/" ? "text-ink" : "hover:text-ink"}
          >
            Dashboard
          </Link>
          <Link
            href="/players"
            className={pathname === "/players" ? "text-ink" : "hover:text-ink"}
          >
            Players
          </Link>
          <Link href="/#methodology" className="hover:text-ink">
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}
