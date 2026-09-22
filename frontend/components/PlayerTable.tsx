"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchLeaderboard, type LeaderboardPlayer } from "@/lib/api";

const POSITIONS = ["All", "QB", "RB", "WR", "TE"] as const;

function VerdictBadge({ overpaying }: { overpaying: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-display text-[12px] font-semibold uppercase tracking-wide ${
        overpaying ? "bg-overpay-bg text-overpay" : "bg-value-bg text-value"
      }`}
    >
      {overpaying ? "Overpay" : "Value"}
    </span>
  );
}

export default function PlayerTable() {
  const router = useRouter();
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<"best_value" | "biggest_overpay">("best_value");
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // 200 is the API's own max (see api/main.py's Query ge/le bounds) --
    // comfortably above the current 174-contract training set so the
    // "full" player list doesn't silently truncate as it grows.
    fetchLeaderboard({ position, sort, limit: 200 })
      .then((res) => setPlayers(res.players))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load players."))
      .finally(() => setLoading(false));
  }, [position, sort]);

  const filtered = players.filter((p) =>
    p.player.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <section className="border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
            Player valuations
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {filtered.length} of {players.length} skill-position contracts with a resolved
            valuation
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players…"
          className="w-56 rounded border border-border-strong bg-surface px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-sunken px-6 py-3">
        <div className="flex gap-1">
          {POSITIONS.map((p) => {
            const active = p === "All" ? position === undefined : position === p;
            return (
              <button
                key={p}
                onClick={() => setPosition(p === "All" ? undefined : p)}
                className={`rounded px-3 py-1 font-display text-[13px] font-semibold uppercase tracking-wide ${
                  active
                    ? "bg-accent text-white"
                    : "text-ink-soft hover:bg-surface hover:text-ink"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1 font-display text-[13px] font-semibold uppercase tracking-wide">
          <button
            onClick={() => setSort("best_value")}
            className={`rounded px-3 py-1 ${
              sort === "best_value" ? "bg-ink text-white" : "text-ink-soft hover:bg-surface"
            }`}
          >
            Best value
          </button>
          <button
            onClick={() => setSort("biggest_overpay")}
            className={`rounded px-3 py-1 ${
              sort === "biggest_overpay" ? "bg-ink text-white" : "text-ink-soft hover:bg-surface"
            }`}
          >
            Biggest overpay
          </button>
        </div>
      </div>

      {error && <p className="px-6 py-4 text-sm text-overpay">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left font-display text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-6 py-2.5">Player</th>
              <th className="px-3 py-2.5">Pos</th>
              <th className="px-3 py-2.5">Signed</th>
              <th
                className="cursor-help px-3 py-2.5 text-right"
                title="Share of the salary cap the player was actually paid at signing."
              >
                Cap %
              </th>
              <th
                className="cursor-help px-3 py-2.5 text-right"
                title="Share of the cap the model predicts based on the player's production the season before signing."
              >
                Model expects
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
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-ink-faint">
                  No players match &ldquo;{search}&rdquo;.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr
                  key={p.player}
                  onClick={() => router.push(`/player/${encodeURIComponent(p.player)}`)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent-soft"
                >
                  <td className="px-6 py-3 font-semibold text-ink">
                    {p.player}
                    {p.low_confidence && (
                      <span
                        title="Limited trailing production (<8 games or <20 fantasy points) — treat this valuation with caution"
                        className="ml-2 rounded bg-amber-bg px-1.5 py-0.5 font-mono text-[10px] font-normal text-amber"
                      >
                        LOW SAMPLE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink-soft">{p.position}</td>
                  <td className="px-3 py-3 text-ink-soft">{p.signing_season}</td>
                  <td className="px-3 py-3 text-right font-mono tabular text-ink">
                    {p.actual_cap_pct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular text-ink-soft">
                    {p.predicted_cap_pct.toFixed(2)}%
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
    </section>
  );
}
