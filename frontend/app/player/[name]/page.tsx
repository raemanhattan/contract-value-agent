"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PeerComparisonChart from "@/components/PeerComparisonChart";
import ProductionTrend from "@/components/ProductionTrend";
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

      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-3 sm:px-8">
          <nav className="font-mono text-[12px] text-ink-faint">
            <Link href="/" className="hover:text-ink">
              Players
            </Link>
            {contract?.contract?.position && (
              <>
                {" / "}
                <span>{contract.contract.position}</span>
              </>
            )}
            {" / "}
            <span className="text-ink">{player}</span>
          </nav>
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
            {/* Title + contract facts */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
              <div>
                <p className="font-mono text-[12px] uppercase tracking-wide text-ink-faint">
                  {contract?.contract?.position ?? surplus?.position ?? ""} ·{" "}
                  {contract?.contract?.team ?? ""} · signed{" "}
                  {contract?.contract?.start_year ?? surplus?.signing_season ?? ""}
                </p>
                <h1 className="font-display text-5xl font-bold uppercase tracking-tight text-ink">
                  {player}
                </h1>

                {contract?.found && contract.contract && (
                  <div className="mt-5 grid grid-cols-2 divide-x divide-border border border-border sm:grid-cols-4">
                    <HeaderStat label="Length" value={`${contract.contract.length_years} yr`} />
                    <HeaderStat label="Total" value={formatMoney(contract.contract.total_value)} />
                    <HeaderStat label="Avg / yr" value={formatMoney(contract.contract.average_salary)} />
                    {contract.current_cap_hit ? (
                      <HeaderStat
                        label={`${contract.current_cap_hit.season} cap hit`}
                        value={formatMoney(contract.current_cap_hit.cap_hit)}
                      />
                    ) : (
                      <HeaderStat label="Signed" value={String(contract.contract.start_year)} />
                    )}
                  </div>
                )}
              </div>

              {surplus?.found && surplus.pay_vs_production_ratio !== undefined && (
                <div
                  className={`border p-5 ${
                    surplus.team_is_overpaying
                      ? "border-overpay/30 bg-overpay-bg"
                      : "border-value/30 bg-value-bg"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex items-center gap-1.5 font-display text-lg font-bold uppercase tracking-tight ${
                        surplus.team_is_overpaying ? "text-overpay" : "text-value"
                      }`}
                    >
                      <span aria-hidden>{surplus.team_is_overpaying ? "▲" : "●"}</span>
                      {surplus.team_is_overpaying ? "Overpay" : "Good Value"}
                    </span>
                    <span className="font-mono text-[13px] text-ink-faint">
                      {surplus.pay_vs_production_ratio.toFixed(2)}×
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                    {plainVerdict()}
                  </p>

                  {surplus.actual_cap_pct_at_signing !== undefined &&
                    surplus.model_predicted_cap_pct !== undefined && (
                      <div className="mt-4 space-y-2">
                        <ExpectedActualBar
                          label="Expected"
                          value={surplus.model_predicted_cap_pct}
                          max={Math.max(surplus.model_predicted_cap_pct, surplus.actual_cap_pct_at_signing)}
                          tone="faint"
                        />
                        <ExpectedActualBar
                          label="Actual"
                          value={surplus.actual_cap_pct_at_signing}
                          max={Math.max(surplus.model_predicted_cap_pct, surplus.actual_cap_pct_at_signing)}
                          tone={surplus.team_is_overpaying ? "overpay" : "value"}
                        />
                      </div>
                    )}

                  {surplus.trailing_production && (
                    <p className="mt-4 border-t border-border pt-3 text-[12px] leading-relaxed text-ink-faint">
                      Based on{" "}
                      <span className="tabular font-medium text-ink-soft">
                        {surplus.trailing_production.fantasy_points_ppr.toFixed(0)} fantasy points
                      </span>{" "}
                      over{" "}
                      <span className="tabular font-medium text-ink-soft">
                        {surplus.trailing_production.games} games
                      </span>{" "}
                      in {(surplus.signing_season ?? 1) - 1}, the season before signing.{" "}
                      <a href="#production-trend" className="text-accent hover:underline">
                        Why this number?
                      </a>
                      {surplus.low_confidence && (
                        <span className="text-amber"> — a small sample, treat with caution.</span>
                      )}
                    </p>
                  )}
                </div>
              )}
              {!surplus?.found && (
                <div className="border border-border bg-surface p-5 text-[14px] text-ink-soft">
                  {surplus?.note ?? "No market-model valuation available for this player."}
                </div>
              )}
            </section>

            {/* Production trend */}
            {data.stats_history.length > 0 && (
              <div id="production-trend" className="scroll-mt-20">
                <ProductionTrend
                  rows={data.stats_history}
                  highlightSeason={(surplus?.signing_season ?? 1) - 1}
                  position={contract?.contract?.position ?? surplus?.position}
                />
              </div>
            )}

            {/* Full season-by-season table */}
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

function ExpectedActualBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "faint" | "value" | "overpay";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barColor =
    tone === "faint" ? "bg-ink-faint/50" : tone === "overpay" ? "bg-overpay" : "bg-value";
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <div className="h-2 flex-1 rounded-full bg-surface-sunken">
        <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-[11px] text-ink">
        {value.toFixed(2)}%
      </span>
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
