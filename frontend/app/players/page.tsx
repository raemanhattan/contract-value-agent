import SiteHeader from "@/components/SiteHeader";
import PlayerTable from "@/components/PlayerTable";

export default function PlayersPage() {
  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8">
        <PlayerTable />
      </main>
    </div>
  );
}
