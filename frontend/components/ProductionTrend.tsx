"use client";

import type { SeasonStatsRow } from "@/lib/api";

function BarSpark({
  rows,
  valueKey,
  highlightSeason,
}: {
  rows: SeasonStatsRow[];
  valueKey: keyof SeasonStatsRow;
  highlightSeason: number;
}) {
  const values = rows.map((r) => Number(r[valueKey]));
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-20 items-end gap-1.5">
      {rows.map((r) => {
        const v = Number(r[valueKey]);
        const isCurrent = r.season === highlightSeason;
        return (
          <div key={r.season} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-t ${isCurrent ? "bg-accent" : "bg-ink-faint/40"}`}
              style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              title={`${r.season}: ${v.toFixed(1)}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function LineSpark({
  rows,
  valueKey,
  highlightSeason,
}: {
  rows: SeasonStatsRow[];
  valueKey: keyof SeasonStatsRow;
  highlightSeason: number;
}) {
  const values = rows.map((r) => Number(r[valueKey]));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 100;
  const h = 60;
  const step = rows.length > 1 ? w / (rows.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 10) - 5;
    return { x, y };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full overflow-visible">
      <path d={path} fill="none" stroke="var(--ink-faint)" strokeWidth="1.5" />
      {points.map((p, i) => {
        const isCurrent = rows[i].season === highlightSeason;
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={isCurrent ? 3 : 2}
            fill={isCurrent ? "var(--accent)" : "var(--ink-faint)"}
          />
        );
      })}
    </svg>
  );
}

export default function ProductionTrend({
  rows,
  highlightSeason,
  position,
}: {
  rows: SeasonStatsRow[];
  highlightSeason: number;
  position?: string;
}) {
  const sorted = [...rows].sort((a, b) => a.season - b.season);
  const passing = position === "QB";

  return (
    <section className="border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
          Production trend
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Per-game rates, so missed games don&rsquo;t read as a decline · {sorted.length} seasons
        </p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <TrendColumn
          label="Fantasy pts / game"
          rows={sorted}
          valueKey="fantasy_points_ppr"
          gamesKey="games"
          highlightSeason={highlightSeason}
          chart="bar"
        />
        <TrendColumn
          label={passing ? "Pass yds / game" : "Rush yds / game"}
          rows={sorted}
          valueKey={passing ? "passing_yards" : "rushing_yards"}
          gamesKey="games"
          highlightSeason={highlightSeason}
          chart="line"
        />
        <TrendColumn
          label={passing ? "Pass TD / game" : "Rec / game"}
          rows={sorted}
          valueKey={passing ? "passing_tds" : "receptions"}
          gamesKey="games"
          highlightSeason={highlightSeason}
          chart="line"
        />
      </div>
    </section>
  );
}

function TrendColumn({
  label,
  rows,
  valueKey,
  gamesKey,
  highlightSeason,
  chart,
}: {
  label: string;
  rows: SeasonStatsRow[];
  valueKey: keyof SeasonStatsRow;
  gamesKey: keyof SeasonStatsRow;
  highlightSeason: number;
  chart: "bar" | "line";
}) {
  const perGame = rows.map((r) => ({
    ...r,
    [valueKey]: Number(r[gamesKey]) > 0 ? Number(r[valueKey]) / Number(r[gamesKey]) : 0,
  })) as SeasonStatsRow[];

  const current = perGame.find((r) => r.season === highlightSeason);
  const prev = perGame[perGame.findIndex((r) => r.season === highlightSeason) - 1];
  const delta = current && prev ? Number(current[valueKey]) - Number(prev[valueKey]) : null;

  return (
    <div className="px-6 py-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          {label}
        </span>
        {current && (
          <span className="font-mono text-[15px] font-semibold text-ink">
            {Number(current[valueKey]).toFixed(1)}
            {delta !== null && (
              <span className={delta < 0 ? "ml-1 text-overpay" : "ml-1 text-value"}>
                {delta < 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(1)}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="mt-3">
        {chart === "bar" ? (
          <BarSpark rows={perGame} valueKey={valueKey} highlightSeason={highlightSeason} />
        ) : (
          <LineSpark rows={perGame} valueKey={valueKey} highlightSeason={highlightSeason} />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        {rows.map((r) => (
          <span key={r.season} className={r.season === highlightSeason ? "text-accent" : ""}>
            &apos;{String(r.season).slice(2)}
          </span>
        ))}
      </div>
    </div>
  );
}
