export default function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="border-r border-white/10 px-6 py-4 last:border-r-0">
      <div className="font-mono text-[11px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold text-white">{value}</div>
      {sublabel && <div className="mt-0.5 text-[12px] text-white/40">{sublabel}</div>}
    </div>
  );
}
