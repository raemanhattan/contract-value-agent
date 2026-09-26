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

function MiniDiagram() {
  return (
    <svg viewBox="0 0 260 130" className="w-full" aria-hidden>
      <defs>
        <linearGradient id="overpayZone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--overpay-red)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--overpay-red)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="valueZone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--value-green)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--value-green)" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="260" height="130" fill="url(#overpayZone)" />
      <rect x="0" y="0" width="260" height="130" fill="url(#valueZone)" />
      <path
        d="M 10 118 Q 90 108 150 70 T 250 20"
        fill="none"
        stroke="var(--ink-faint)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <circle cx="150" cy="70" r="3.5" fill="var(--accent)" />
      <line x1="150" y1="70" x2="150" y2="40" stroke="var(--overpay-red)" strokeWidth="1.3" />
      <path d="M 150 40 l -3 6 h 6 z" fill="var(--overpay-red)" />
      <text x="154" y="42" fontSize="7" fontFamily="var(--font-mono)" fill="var(--overpay-red)">
        paid above → overpay
      </text>
      <text x="10" y="126" fontSize="7" fontFamily="var(--font-mono)" fill="var(--value-green)">
        paid below → value
      </text>
      <text x="60" y="14" fontSize="7" fontFamily="var(--font-mono)" fill="var(--ink-faint)">
        expected pay
      </text>
      <text x="4" y="64" fontSize="7" fontFamily="var(--font-mono)" fill="var(--ink-faint)" transform="rotate(-90 10 70)">
      </text>
    </svg>
  );
}

export function ValueSidebar() {
  return (
    <div className="space-y-4">
      <section className="border border-border bg-surface p-6">
        <h3 className="font-display text-lg font-bold uppercase tracking-tight text-ink">
          How value is calculated
        </h3>
        <div className="mt-4 rounded border border-border bg-surface-sunken p-3">
          <MiniDiagram />
          <p className="mt-1 text-center font-mono text-[10px] text-ink-faint">
            production before signing →
          </p>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
          The model predicts what share of the cap a player&apos;s production{" "}
          <em>before</em> signing is worth. Paid more than that:{" "}
          <span className="font-semibold text-overpay">overpay</span>. Paid less:{" "}
          <span className="font-semibold text-value">good value</span>.
        </p>
        <a
          href="/#methodology"
          className="mt-3 inline-block font-display text-[12px] font-semibold uppercase tracking-wide text-accent hover:underline"
        >
          show the math →
        </a>
      </section>

      <section className="border border-border bg-surface p-6">
        <h3 className="font-display text-[13px] font-bold uppercase tracking-tight text-ink">
          Reading the table
        </h3>
        <dl className="mt-3 space-y-3 text-[12px]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex w-8 shrink-0 items-center gap-0.5">
              <span className="h-1.5 w-3 rounded-full bg-value" />
              <span className="h-3 w-px bg-ink" />
            </div>
            <dd className="text-ink-soft">
              tick = model&apos;s expected pay; bar = actual pay
            </dd>
          </div>
          <div className="flex items-start gap-3">
            <dt className="w-8 shrink-0 font-mono text-[10px] font-semibold text-amber">
              LOW
              <br />
              SAMPLE
            </dt>
            <dd className="text-ink-soft">fewer than 8 games the season before signing</dd>
          </div>
          <div className="flex items-start gap-3">
            <dt className="w-8 shrink-0 font-mono text-[11px] font-semibold text-ink">0.06×</dt>
            <dd className="text-ink-soft">actual pay ÷ expected pay</dd>
          </div>
        </dl>
      </section>
    </div>
  );
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-tight text-ink">
              How player value is calculated
            </h2>
            <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-soft">
              A statistical model predicts what share of the salary cap a player&apos;s
              production <em>before</em> signing should be worth. If a player is actually paid
              more than that prediction, the deal is an{" "}
              <strong className="text-overpay">overpay</strong> for the team. If paid less,
              it&apos;s <strong className="text-value">good value</strong>.
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
