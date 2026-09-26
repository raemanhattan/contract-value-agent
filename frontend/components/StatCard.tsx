export default function StatCard({
  label,
  value,
  sublabel,
  highlight,
}: {
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <div className="border-r border-border px-6 py-3 last:border-r-0">
      <span className={`text-[13px] ${highlight ? "text-accent" : "text-ink-soft"}`}>
        <span className="font-mono font-semibold text-ink">{value}</span> {label}
      </span>
      {sublabel && <span className="ml-1 text-[13px] text-ink-faint">{sublabel}</span>}
    </div>
  );
}
