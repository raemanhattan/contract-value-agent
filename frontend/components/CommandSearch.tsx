"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchLeaderboard, type LeaderboardPlayer } from "@/lib/api";

let cache: LeaderboardPlayer[] | null = null;
let cachePromise: Promise<LeaderboardPlayer[]> | null = null;

function loadAllPlayers(): Promise<LeaderboardPlayer[]> {
  if (cache) return Promise.resolve(cache);
  if (!cachePromise) {
    cachePromise = fetchLeaderboard({ sort: "best_value", limit: 200 }).then((res) => {
      cache = res.players;
      return res.players;
    });
  }
  return cachePromise;
}

export default function CommandSearch({
  variant = "nav",
  onAsk,
}: {
  variant?: "nav" | "hero";
  onAsk?: (question: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAllPlayers().then(setPlayers);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    function onSlash(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        containerRef.current?.querySelector("input")?.focus();
      }
    }
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return players
      .filter(
        (p) =>
          p.player.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [players, query]);

  function openPlayer(p: LeaderboardPlayer) {
    setOpen(false);
    setQuery("");
    router.push(`/player/${encodeURIComponent(p.player)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[activeIndex]) {
        openPlayer(matches[activeIndex]);
      } else if (query.trim() && onAsk) {
        onAsk(query.trim());
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const width = variant === "nav" ? "w-full max-w-md" : "w-full";

  return (
    <div ref={containerRef} className={`relative ${width}`}>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={variant === "nav" ? "Jump to a player…" : "Search a player, team, or position…"}
          className={`w-full rounded-md border bg-surface py-2.5 pl-9 pr-10 text-ink placeholder:text-ink-faint focus:outline-none ${
            variant === "hero"
              ? "border-accent/60 text-[15px] focus:border-accent"
              : "border-border-strong text-[13px] focus:border-accent"
          }`}
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
          /
        </kbd>
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-md border border-border-strong bg-surface shadow-xl">
          {matches.length > 0 && (
            <>
              <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                Players
              </div>
              <ul>
                {matches.map((p, i) => (
                  <li key={p.player}>
                    <button
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => openPlayer(p)}
                      className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left ${
                        i === activeIndex ? "bg-surface-raised" : ""
                      }`}
                    >
                      <span className="font-semibold text-ink underline decoration-ink-faint/40 underline-offset-2">
                        {p.player}
                      </span>
                      <span className="flex items-center gap-4 font-mono text-[12px]">
                        <span className="text-ink-faint">
                          {p.position} · {p.team}
                        </span>
                        <span
                          className={
                            p.team_is_overpaying
                              ? "flex items-center gap-1 text-overpay"
                              : "flex items-center gap-1 text-value"
                          }
                        >
                          {p.team_is_overpaying ? "▲ OVERPAY" : "● VALUE"}
                        </span>
                        <span className="w-14 text-right text-ink-faint">
                          {p.pay_vs_production_ratio.toFixed(2)}×
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {onAsk && (
            <div className="border-t border-border px-4 py-3">
              <button
                onClick={() => {
                  onAsk(query.trim());
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 text-left text-[13px] text-ink-soft hover:text-ink"
              >
                <span aria-hidden>💬</span>
                Not who you meant?{" "}
                <span className="text-accent">Ask &ldquo;{query.trim()}…&rdquo; as a question →</span>
              </button>
            </div>
          )}
          {matches.length === 0 && !onAsk && (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              No players match &ldquo;{query.trim()}&rdquo;.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
