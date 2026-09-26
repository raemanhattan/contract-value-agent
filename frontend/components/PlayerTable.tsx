"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchLeaderboard, type LeaderboardPlayer } from "@/lib/api";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const PAGE_SIZE = 25;

function VerdictBadge({ overpaying }: { overpaying: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-display text-[12px] font-semibold uppercase tracking-wide ${
        overpaying ? "bg-overpay-bg text-overpay" : "bg-value-bg text-value"
      }`}
    >
      <span aria-hidden>{overpaying ? "▲" : "●"}</span>
      {overpaying ? "Overpay" : "Value"}
    </span>
  );
}

function PayBar({ actual, expected }: { actual: number; expected: number }) {
  const max = Math.max(actual, expected, 0.01) * 1.15;
  const actualPct = Math.min(100, (actual / max) * 100);
  const expectedPct = Math.min(100, (expected / max) * 100);
  return (
    <div className="w-40">
      <div className="relative h-1.5 rounded-full bg-surface-sunken">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-value"
          style={{ width: `${actualPct}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink"
          style={{ left: `${expectedPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{actual.toFixed(2)}% paid</span>
        <span>{expected.toFixed(2)}% expected</span>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-6 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-sunken" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-8 animate-pulse rounded bg-surface-sunken" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-12 animate-pulse rounded bg-surface-sunken" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-40 animate-pulse rounded bg-surface-sunken" />
      </td>
      <td className="px-3 py-3 text-right">
        <div className="ml-auto h-4 w-10 animate-pulse rounded bg-surface-sunken" />
      </td>
      <td className="px-6 py-3 text-right">
        <div className="ml-auto h-6 w-16 animate-pulse rounded bg-surface-sunken" />
      </td>
    </tr>
  );
}

export default function PlayerTable() {
  const router = useRouter();
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<"best_value" | "biggest_overpay">("best_value");
  const [hideMinSalary, setHideMinSalary] = useState(false);
  const [page, setPage] = useState(0);
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPage(0);
    // 200 is the API's own max (see api/main.py's Query ge/le bounds) --
    // comfortably above the current 174-contract training set so the
    // "full" player list doesn't silently truncate as it grows.
    fetchLeaderboard({ position, sort, limit: 200 })
      .then((res) => setPlayers(res.players))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load players."))
      .finally(() => setLoading(false));
  }, [position, sort]);

  const filtered = useMemo(
    () =>
      hideMinSalary
        ? players.filter((p) => p.actual_cap_pct > 0.6)
        : players,
    [players, hideMinSalary]
  );

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <section className="border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
            Browse all valuations
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {filtered.length} skill-position contracts with a model price
          </p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-border-strong">
          <button
            onClick={() => setSort("best_value")}
            className={`flex items-center gap-1.5 px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wide ${
              sort === "best_value" ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-sunken"
            }`}
          >
            <span aria-hidden>●</span> Best value
          </button>
          <button
            onClick={() => setSort("biggest_overpay")}
            className={`flex items-center gap-1.5 border-l border-border-strong px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wide ${
              sort === "biggest_overpay"
                ? "bg-accent text-white"
                : "text-ink-soft hover:bg-surface-sunken"
            }`}
          >
            <span aria-hidden>▲</span> Biggest overpay
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-sunken px-6 py-3">
        <div className="flex gap-1">
          {POSITIONS.map((p) => {
            const active = p === "ALL" ? position === undefined : position === p;
            return (
              <button
                key={p}
                onClick={() => setPosition(p === "ALL" ? undefined : p)}
                className={`rounded px-3 py-1 font-display text-[13px] font-semibold uppercase tracking-wide ${
                  active ? "bg-accent text-white" : "text-ink-soft hover:bg-surface hover:text-ink"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={hideMinSalary}
            onChange={(e) => setHideMinSalary(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong accent-accent"
          />
          Hide minimum-salary deals
        </label>
      </div>

      {error && <p className="px-6 py-4 text-sm text-overpay">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left font-display text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-6 py-2.5">Player</th>
              <th className="px-3 py-2.5">Pos</th>
              <th className="px-3 py-2.5">Signed</th>
              <th
                className="cursor-help px-3 py-2.5"
                title="Actual share of the salary cap vs. what the model expects, shown as a bar."
              >
                Paid vs. model (% of cap)
              </th>
              <th
                className="cursor-help px-3 py-2.5 text-right"
                title="Actual ÷ model expected. Above 1.0 = paid more than production justifies."
              >
                Ratio
              </th>
              <th className="px-6 py-2.5 text-right">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-ink-faint">
                  No players match these filters.
                </td>
              </tr>
            ) : (
              paged.map((p) => (
                <tr
                  key={p.player}
                  onClick={() => router.push(`/player/${encodeURIComponent(p.player)}`)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-raised"
                >
                  <td className="px-6 py-3">
                    <div className="font-semibold text-ink">{p.player}</div>
                    <div className="font-mono text-[11px] text-ink-faint">
                      {p.team}
                      {p.low_confidence && (
                        <span
                          title="Limited trailing production (<8 games or <20 fantasy points) — treat this valuation with caution"
                          className="ml-2 text-amber"
                        >
                          · LOW SAMPLE
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink-soft">{p.position}</td>
                  <td className="px-3 py-3 text-ink-soft">{p.signing_season}</td>
                  <td className="px-3 py-3">
                    <PayBar actual={p.actual_cap_pct} expected={p.predicted_cap_pct} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular font-semibold text-ink">
                    {p.pay_vs_production_ratio.toFixed(2)}×
                  </td>
                  <td className="px-6 py-3 text-right">
                    <VerdictBadge overpaying={p.team_is_overpaying} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-6 py-3 text-[13px] text-ink-faint">
        <span>
          showing {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–
          {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
        </span>
        <div className="flex gap-4">
          {page > 0 && (
            <button onClick={() => setPage((p) => p - 1)} className="text-accent hover:underline">
              ← prev {PAGE_SIZE}
            </button>
          )}
          {page < totalPages - 1 && (
            <button onClick={() => setPage((p) => p + 1)} className="text-accent hover:underline">
              next {PAGE_SIZE} →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
