"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import { fetchScatter, type ScatterPoint, type ScatterResponse } from "@/lib/api";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
// How many of the highest-production dots get an always-visible name
// label directly on the chart, so a first-time viewer isn't stuck
// hovering blindly to find out who any given dot is. The rest show
// their name on hover (see the self-managed tooltip below -- recharts'
// built-in <Tooltip> does not reliably fire over a fully custom SVG
// shape, so hover state is tracked directly here instead).
const ALWAYS_LABELED_COUNT = 6;

interface HoverState {
  point: ScatterPoint;
  x: number;
  y: number;
}

function HoverTooltip({ hover }: { hover: HoverState | null }) {
  if (!hover) return null;
  const p = hover.point;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full border border-border-strong bg-surface px-3 py-2 font-mono text-[12px] text-ink shadow-lg"
      style={{ left: hover.x, top: hover.y - 12 }}
    >
      <div className="font-display text-[13px] font-bold uppercase tracking-wide">{p.player}</div>
      <div className="mt-1 text-ink-soft">{p.trailing_fantasy_points_ppr.toFixed(0)} points before signing</div>
      <div className="text-ink-soft">paid {p.actual_cap_pct.toFixed(2)}% of cap</div>
      <div className={p.team_is_overpaying ? "text-overpay" : "text-value"}>
        {p.team_is_overpaying ? "above the line: overpay" : "below the line: good value"}
      </div>
      <div className="mt-1 text-ink-faint">click to see full detail →</div>
    </div>
  );
}

// A stable label offset computed purely from the DATA (not pixel
// coordinates, which vary with container size and would need a
// re-render-triggering ref sync -- that caused an infinite tiny-update
// loop in an earlier version of this component). Points close together
// in data-space alternate above/below and step outward, so labels in a
// tight cluster fan out instead of stacking on top of each other.
function computeLabelOffsets(
  points: ScatterPoint[],
  xRange: number,
  yRange: number
): Map<string, { dx: number; dy: number }> {
  const sorted = [...points].sort((a, b) => a.trailing_fantasy_points_ppr - b.trailing_fantasy_points_ppr);
  const offsets = new Map<string, { dx: number; dy: number }>();
  const xThreshold = xRange * 0.08;
  const yThreshold = yRange * 0.06;

  let sameClusterCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const closeToPrev =
      prev !== undefined &&
      Math.abs(cur.trailing_fantasy_points_ppr - prev.trailing_fantasy_points_ppr) < xThreshold &&
      Math.abs(cur.actual_cap_pct - prev.actual_cap_pct) < yThreshold;
    sameClusterCount = closeToPrev ? sameClusterCount + 1 : 0;
    const step = 14 + sameClusterCount * 13;
    const above = sameClusterCount % 2 === 0;
    offsets.set(cur.player, { dx: 0, dy: above ? -step : step });
  }
  return offsets;
}

export default function PeerComparisonChart({
  highlightPlayer,
  initialPosition = "QB",
}: {
  highlightPlayer?: string;
  initialPosition?: string;
}) {
  const router = useRouter();
  const [position, setPosition] = useState(initialPosition);
  const [data, setData] = useState<ScatterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchScatter(position)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load chart."))
      .finally(() => setLoading(false));
  }, [position]);

  const otherPoints = useMemo(
    () => data?.points.filter((p) => p.player !== highlightPlayer) ?? [],
    [data, highlightPlayer]
  );
  const highlighted = useMemo(
    () => data?.points.filter((p) => p.player === highlightPlayer) ?? [],
    [data, highlightPlayer]
  );

  const alwaysLabeled = useMemo(
    () =>
      new Set(
        [...otherPoints]
          .sort((a, b) => b.trailing_fantasy_points_ppr - a.trailing_fantasy_points_ppr)
          .slice(0, ALWAYS_LABELED_COUNT)
          .map((p) => p.player)
      ),
    [otherPoints]
  );

  const labelOffsets = useMemo(() => {
    if (!data) return new Map<string, { dx: number; dy: number }>();
    const labeledPoints = data.points.filter(
      (p) => p.player === highlightPlayer || alwaysLabeled.has(p.player)
    );
    const xs = data.points.map((p) => p.trailing_fantasy_points_ppr);
    const ys = data.points.map((p) => p.actual_cap_pct);
    const xRange = Math.max(...xs) - Math.min(...xs) || 1;
    const yRange = Math.max(...ys) - Math.min(...ys) || 1;
    return computeLabelOffsets(labeledPoints, xRange, yRange);
  }, [data, alwaysLabeled, highlightPlayer]);

  function handlePointClick(player: string) {
    router.push(`/player/${encodeURIComponent(player)}`);
  }

  function renderDot(isStar: boolean) {
    return (props: { cx?: number; cy?: number; payload?: ScatterPoint }) => {
      const { cx, cy, payload } = props;
      if (cx === undefined || cy === undefined || !payload) return <g />;
      const color = isStar
        ? "var(--accent)"
        : payload.team_is_overpaying
          ? "var(--overpay-red)"
          : "var(--value-green)";
      const showLabel = isStar || alwaysLabeled.has(payload.player);
      const offset = labelOffsets.get(payload.player) ?? { dx: 0, dy: -14 };

      return (
        <g
          style={{ cursor: "pointer" }}
          onClick={() => handlePointClick(payload.player)}
          onMouseEnter={() => setHover({ point: payload, x: cx, y: cy })}
          onMouseLeave={() => setHover((h) => (h?.point.player === payload.player ? null : h))}
        >
          <circle cx={cx} cy={cy} r={11} fill="transparent" />
          {isStar ? (
            <path
              d={`M ${cx} ${cy - 8} L ${cx + 2.3} ${cy - 2.3} L ${cx + 8} ${cy - 2.3} L ${cx + 3.4} ${cy + 1.2} L ${cx + 4.6} ${cy + 6.8} L ${cx} ${cy + 3.4} L ${cx - 4.6} ${cy + 6.8} L ${cx - 3.4} ${cy + 1.2} L ${cx - 8} ${cy - 2.3} L ${cx - 2.3} ${cy - 2.3} Z`}
              fill={color}
              stroke="white"
              strokeWidth={1}
            />
          ) : (
            <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.85} stroke="white" strokeWidth={1} />
          )}
          {showLabel && (
            <text
              x={cx + offset.dx}
              y={cy + offset.dy}
              textAnchor="middle"
              fontSize={11}
              fontFamily="var(--font-mono)"
              fill={isStar ? "var(--accent)" : "var(--ink-soft)"}
              fontWeight={isStar ? 700 : 500}
            >
              {payload.player}
            </text>
          )}
        </g>
      );
    };
  }

  return (
    <section className="border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
            Pay vs. peers
          </h2>
          <p className="mt-1 max-w-[58ch] text-[13px] leading-relaxed text-ink-soft">
            Every dot is a real contract at this position. Right = more production before
            signing. Up = more of the salary cap. The dashed line is what the model expects —
            above it is an overpay, below it is good value. Click any dot to open that player.
          </p>
        </div>
        <div className="flex gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPosition(p)}
              className={`rounded px-3 py-1 font-display text-[13px] font-semibold uppercase tracking-wide ${
                position === p ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-sunken"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 px-6 pt-4 font-mono text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-value opacity-85" /> good value
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-overpay opacity-85" /> overpay
        </span>
        <span>· dashed line = expected pay</span>
      </div>

      {error && <p className="px-6 pt-4 text-sm text-overpay">{error}</p>}
      {loading && <p className="px-6 pt-4 text-sm text-ink-faint">Loading…</p>}

      {data && !loading && (
        <div className="px-2 pb-4 pt-2 sm:px-4">
          <div className="relative h-96 w-full">
            <HoverTooltip hover={hover} />
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 28, right: 24, left: 0, bottom: 32 }}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis
                  type="number"
                  dataKey="trailing_fantasy_points_ppr"
                  name="production"
                  tick={{ fill: "var(--ink-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "var(--border-strong)" }}
                  tickLine={false}
                  label={{
                    value: "production the season before signing (higher = better)",
                    position: "bottom",
                    fill: "var(--ink-faint)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    offset: 8,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="actual_cap_pct"
                  name="cap share"
                  unit="%"
                  tick={{ fill: "var(--ink-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "var(--border-strong)" }}
                  tickLine={false}
                  width={44}
                  label={{
                    value: "% of team's salary cap",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--ink-faint)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                />
                <Line
                  data={data.fitted_curve}
                  dataKey="predicted_cap_pct"
                  type="monotone"
                  dot={false}
                  stroke="var(--ink-faint)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  isAnimationActive={false}
                  legendType="none"
                />
                <Scatter data={otherPoints} isAnimationActive={false} shape={renderDot(false) as never} />
                <Scatter data={highlighted} isAnimationActive={false} shape={renderDot(true) as never} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
