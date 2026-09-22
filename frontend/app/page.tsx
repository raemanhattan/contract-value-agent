"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import StatCard from "@/components/StatCard";
import MethodologyPanel from "@/components/MethodologyPanel";
import PlayerTable from "@/components/PlayerTable";
import QueryInterface from "@/components/QueryInterface";
import { fetchModelInfo, type ModelInfo } from "@/lib/api";

export default function Home() {
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    fetchModelInfo().then(setInfo).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />

      <div className="bg-header-raised">
        <div className="mx-auto max-w-7xl px-6 sm:px-8">
          <div className="flex flex-wrap">
            <StatCard
              label="Contracts analyzed"
              value={info ? String(info.total_contracts_in_dataset) : "—"}
              sublabel="active QB / RB / WR / TE contracts"
            />
            <StatCard
              label="Model accuracy"
              value={info ? `${Math.round(info.r_squared * 100)}%` : "—"}
              sublabel="of pay variation explained (R²)"
            />
            <StatCard
              label="Training contracts"
              value={info ? String(info.training_sample_size) : "—"}
              sublabel="signings with resolved prior-season stats"
            />
            <StatCard
              label="Not yet priced"
              value={info ? String(info.contracts_not_yet_priced) : "—"}
              sublabel="mostly rookies with no NFL stats yet"
            />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8 sm:px-8">
        <div id="methodology" className="scroll-mt-6">
          <MethodologyPanel />
        </div>
        <QueryInterface />
        <PlayerTable />
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-[12px] text-ink-faint sm:px-8">
        Market model trained on skill-position contracts with resolved production data from
        the season before signing. Most unpriced contracts belong to rookies with no prior NFL
        stats — their rookie-scale deals are set by draft slot, not production.
      </footer>
    </div>
  );
}
