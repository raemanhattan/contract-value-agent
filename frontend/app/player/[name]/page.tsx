"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PeerComparisonChart from "@/components/PeerComparisonChart";
import {
  ApiNotFoundError,
  fetchPlayerDetail,
  type PlayerDetailResponse,
  type SeasonStatsRow,
} from "@/lib/api";

function CareerStatsTable({ rows, position }: { rows: SeasonStatsRow[]; position?: string }) {
  const showPassing = position === "QB" || rows.some((r) => r.passing_yards > 0);
  const showRushing = rows.some((r) => r.rushing_yards > 0 || r.rushing_tds > 0);
  const showReceiving = position !== "QB" && rows.some((r) => r.receptions > 0);

  return (
    <section className="border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
          Career Stats
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {rows.length} season{rows.length === 1 ? "" : "s"} on record
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left font-display text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="px-6 py-2.5">Season</th>
              <th className="px-3 py-2.5 text-right">GP</th>
              {showPassing && (
                <>
                  <th className="px-3 py-2.5 text-right">Pass Yds</th>
                  <th className="px-3 py-2.5 text-right">Pass TD</th>
                </>
              )}
              {showRushing && (
                <>
                  <th className="px-3 py-2.5 text-right">Rush Yds</th>
                  <th className="px-3 py-2.5 text-right">Rush TD</th>
                </>
              )}
              {showReceiving && (
                <>
                  <th className="px-3 py-2.5 text-right">Rec</th>
                  <th className="px-3 py-2.5 text-right">Rec Yds</th>
                  <th className="px-3 py-2.5 text-right">Rec TD</th>
                </>
              )}
              <th className="px-6 py-2.5 text-right">Fantasy (PPR)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.season} className={i === 0 ? "bg-accent-soft" : "border-b border-border"}>
                <td className="px-6 py-2.5 font-semibold text-ink">{r.season}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">{r.games}</td>
                {showPassing && (
                  <>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.passing_yards.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.passing_tds}
                    </td>
                  </>
                )}
                {showRushing && (
                  <>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.rushing_yards.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.rushing_tds}
                    </td>
                  </>
                )}
                {showReceiving && (
                  <>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.receptions}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.receiving_yards.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-ink-soft">
                      {r.receiving_tds}
                    </td>
                  </>
                )}
                <td className="px-6 py-2.5 text-right font-mono tabular font-semibold text-ink">
                  {r.fantasy_points_ppr.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export default function PlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const player = decodeURIComponent(name);

  const [data, setData] = useState<PlayerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData(null);
    fetchPlayerDetail(player)
      .then(setData)
      .catch((e) => {
        if (e instanceof ApiNotFoundError) {
          setNotFound(true);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load player.");
        }
      })
      .finally(() => setLoading(false));
  }, [player]);

  const surplus = data?.surplus;
  const contract = data?.contract;

  function plainVerdict(): string {
    if (!surplus?.found || surplus.pay_vs_production_ratio === undefined) return "";
    const pct = Math.abs(Math.round((surplus.pay_vs_production_ratio - 1) * 100));
    if (surplus.pay_vs_production_ratio > 1) {
      return `Paid about ${pct}% more than their production before signing would justify.`;
    }
    if (surplus.pay_vs_production_ratio < 1) {
      return `Paid about ${pct}% less than their production before signing would justify.`;
    }
    return "Paid almost exactly what their production before signing would predict.";
  }

  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />

      <div className="border-b border-border-strong bg-header-raised">
        <div className="mx-auto max-w-7xl px-6 py-3 sm:px-8">
          <Link href="/" className="font-display text-[13px] font-semibold uppercase tracking-wide text-white/60 hover:text-white">
            ← Back to dashboard
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
        {loading && <p className="text-ink-faint">Loading…</p>}
        {error && <p className="text-overpay">{error}</p>}
        {notFound && (
          <section className="border border-border bg-surface px-6 py-16 text-center">
            <p className="font-display text-2xl font-bold uppercase tracking-tight text-ink">
              Player not found
            </p>
            <p className="mt-2 text-[14px] text-ink-soft">
              We don&rsquo;t have a contract or valuation on record for &ldquo;{player}&rdquo;.
            </p>
            <Link
              href="/"
              className="mt-6 inline-block font-display text-[13px] font-semibold uppercase tracking-wide text-accent hover:underline"
            >
              ← Back to dashboard
            </Link>
          </section>
        )}

        {data && (
          <div className="space-y-6">
            {/* Player header card */}
            <section className="border border-border bg-surface">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
                <div>
                  <p className="font-mono text-[12px] uppercase tracking-wide text-ink-faint">
                    {contract?.contract?.position ?? surplus?.position ?? ""} ·{" "}
                    {contract?.contract?.team ?? ""}
                  </p>
                  <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-ink">
                    {player}
                  </h1>
                </div>
                {surplus?.found && (
                  <div
                    className={`rounded px-4 py-2 text-center ${
                      surplus.team_is_overpaying ? "bg-overpay-bg" : "bg-value-bg"
                    }`}
                  >
                    <div
                      className={`font-display text-2xl font-bold uppercase tracking-tight ${
                        surplus.team_is_overpaying ? "text-overpay" : "text-value"
                      }`}
                    >
                      {surplus.team_is_overpaying ? "Overpay" : "Good Value"}
                    </div>
                    <div className="font-mono text-[11px] text-ink-faint">
                      {surplus.pay_vs_production_ratio?.toFixed(2)}× expected pay
                    </div>
                  </div>
                )}
              </div>

              {contract?.found && contract.contract && (
                <div className="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-3 lg:grid-cols-6">
                  <HeaderStat label="Contract" value={`${contract.contract.length_years} yr`} />
                  <HeaderStat label="Total value" value={formatMoney(contract.contract.total_value)} />
                  <HeaderStat label="Avg salary" value={formatMoney(contract.contract.average_salary)} />
                  <HeaderStat label="Signed" value={String(contract.contract.start_year)} />
                  {contract.current_cap_hit && (
                    <>
                      <HeaderStat label="2026 cap hit" value={formatMoney(contract.current_cap_hit.cap_hit)} />
                      <HeaderStat
                        label="2026 cap %"
                        value={`${contract.current_cap_hit.cap_hit_pct.toFixed(2)}%`}
                      />
                    </>
                  )}
                </div>
              )}

              {surplus?.found && (
                <div className="px-6 py-5">
                  <p className="text-[15px] font-medium leading-relaxed text-ink">
                    {plainVerdict()}
                  </p>
                  {surplus.trailing_production && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
                      Based on{" "}
                      <span className="tabular font-medium text-ink-soft">
                        {surplus.trailing_production.fantasy_points_ppr.toFixed(0)} fantasy
                        points
                      </span>{" "}
                      over{" "}
                      <span className="tabular font-medium text-ink-soft">
                        {surplus.trailing_production.games} games
                      </span>{" "}
                      the season before signing
                      {surplus.low_confidence && (
                        <> — a small sample, so treat this valuation with caution</>
                      )}
                      .
                    </p>
                  )}
                </div>
              )}
              {!surplus?.found && (
                <div className="px-6 py-5 text-[14px] text-ink-soft">
                  {surplus?.note ?? "No market-model valuation available for this player."}
                </div>
              )}
            </section>

            {/* Career stats table */}
            {data.stats_history.length > 0 && (
              <CareerStatsTable
                rows={data.stats_history}
                position={contract?.contract?.position ?? surplus?.position}
              />
            )}

            {/* Comparison chart */}
            {surplus?.found && (
              <PeerComparisonChart
                highlightPlayer={player}
                initialPosition={surplus.position ?? "QB"}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="px-6 py-4">
      <div className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-0.5 font-display text-xl font-bold text-ink">{value}</div>
      {sublabel && <div className="text-[12px] text-ink-faint">{sublabel}</div>}
    </div>
  );
}
