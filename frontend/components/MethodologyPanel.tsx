"use client";

import { useEffect, useState } from "react";
import { fetchModelInfo, type ModelInfo } from "@/lib/api";

const POS_LABELS: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
};

function coefficientSentence(name: string, estimate: number): string {
  if (name === "log_ppr") {
    return `More production before signing predicts a higher cap share (each doubling of prior fantasy points is associated with about ${(
      (2 ** estimate - 1) *
      100
    ).toFixed(0)}% more cap share).`;
  }
  if (name === "age_at_signing") {
    return `Each additional year of age at signing predicts about ${Math.abs(
      (1 - Math.exp(estimate)) * 100
    ).toFixed(1)}% less cap share, holding production fixed.`;
  }
  const match = name.match(/C\(pos\)\[T\.(\w+)\]/);
  if (match) {
    const pos = POS_LABELS[match[1]] ?? match[1];
    const pctVsQb = ((Math.exp(estimate) - 1) * 100).toFixed(0);
    return `${pos}s are paid about ${Math.abs(Number(pctVsQb))}% ${
      estimate < 0 ? "less" : "more"
    } than quarterbacks for the same level of production — reflecting the real market, not a modeling choice.`;
  }
  return "";
}

export default function MethodologyPanel() {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => undefined);
  }, []);

  return (
    <section className="border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
              How player value is calculated
            </h2>
            <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-soft">
              A statistical model predicts what share of the salary cap a player&apos;s
              production <em>before</em> signing should be worth. If a player is actually paid
              more than that prediction, the deal is an <strong className="text-overpay">overpay</strong>{" "}
              for the team. If paid less, it&apos;s <strong className="text-value">good value</strong>.
            </p>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded border border-border-strong px-3 py-1.5 font-display text-[13px] font-semibold uppercase tracking-wide text-ink-soft hover:bg-surface-sunken"
          >
            {expanded ? "Hide the math" : "Show the math"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">
        <MiniStat label="Model fit (R²)" value={info ? info.r_squared.toFixed(2) : "—"} />
        <MiniStat
          label="Contracts trained on"
          value={info ? String(info.training_sample_size) : "—"}
        />
        <MiniStat
          label="Total contracts tracked"
          value={info ? String(info.total_contracts_in_dataset) : "—"}
        />
        <MiniStat
          label="Not yet priced"
          value={info ? String(info.contracts_not_yet_priced) : "—"}
        />
      </div>

      {expanded && info && (
        <div className="border-t border-border bg-surface-sunken px-6 py-5">
          <p className="font-mono text-[12px] text-ink-soft">{info.formula}</p>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-ink-faint">
            Fit with ordinary least squares on {info.training_sample_size} contracts that had
            resolved production data from the season before signing (
            {Object.entries(info.training_sample_by_position)
              .map(([pos, n]) => `${n} ${pos}`)
              .join(", ")}
            ). Modeled in log space so predicted cap share can never go negative. R² of{" "}
            {info.r_squared.toFixed(2)} means the model explains about{" "}
            {Math.round(info.r_squared * 100)}% of the variation in what players are actually
            paid — the rest is negotiation leverage, team cap situation, and other factors this
            model doesn&apos;t see.
          </p>
          <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-ink-soft">
            {Object.entries(info.coefficients)
              .filter(([name]) => name !== "Intercept")
              .map(([name, { estimate, p_value }]) => {
                const sentence = coefficientSentence(name, estimate);
                if (!sentence) return null;
                return (
                  <li key={name} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>
                      {sentence}{" "}
                      <span className="font-mono text-[11px] text-ink-faint">
                        (p {p_value < 0.001 ? "< 0.001" : `= ${p_value.toFixed(3)}`})
                      </span>
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
            Contract length isn&apos;t used as a predictor — it&apos;s an outcome of the
            negotiation, not something a team decides in advance, so including it would let the
            model partly predict pay from itself.
          </p>
        </div>
      )}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-6 py-4">
      <div className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold text-ink">{value}</div>
    </div>
  );
}
