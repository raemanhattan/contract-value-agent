"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import StatCard from "@/components/StatCard";
import MethodologyPanel from "@/components/MethodologyPanel";
import { ValueSidebar } from "@/components/MethodologyPanel";
import PlayerTable from "@/components/PlayerTable";
import QueryInterface from "@/components/QueryInterface";
import CommandSearch from "@/components/CommandSearch";
import { fetchModelInfo, type ModelInfo } from "@/lib/api";

export default function Home() {
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />

      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap px-6 sm:px-8">
          <StatCard
            label="contracts valued"
            value={info ? String(info.training_sample_size) : "—"}
          />
          <StatCard
            label={`tracked · ${
              info ? info.contracts_not_yet_priced : "—"
            } awaiting a first NFL season`}
            value={info ? String(info.total_contracts_in_dataset) : "—"}
          />
          <StatCard label="model fit R²" value={info ? info.r_squared.toFixed(2) : "—"} />
          <StatCard label="stats through" value="2025 season" highlight />
        </div>
      </div>

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-14 text-center sm:px-8">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-wide text-accent">
            Contract lookup
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold uppercase tracking-tight text-ink sm:text-5xl">
            Is this contract worth the cap space?
          </h1>
          <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
            Look up any valued QB, RB, WR or TE contract to see what the model expects them to
            be paid — and whether their team got a deal.
          </p>

          <div className="mx-auto mt-8 max-w-xl">
            <CommandSearch variant="hero" />
          </div>

          <div className="mx-auto mt-8 max-w-xl">
            <QueryInterface />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <PlayerTable />
          <ValueSidebar />
        </div>

        <div id="methodology" className="mt-6 scroll-mt-20">
          <MethodologyPanel />
        </div>
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-[12px] text-ink-faint sm:px-8">
        Market model trained on skill-position contracts with resolved production data from
        the season before signing. Most unpriced contracts belong to rookies with no prior NFL
        stats — their rookie-scale deals are set by draft slot, not production.
      </footer>
    </div>
  );
}
