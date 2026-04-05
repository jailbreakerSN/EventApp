import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tableau de bord" };

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Tableau de bord</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Événements actifs" value="—" />
        <StatCard label="Participants total" value="—" />
        <StatCard label="Check-ins aujourd'hui" value="—" />
        <StatCard label="Badges générés" value="—" />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold text-[#1A1A2E] mt-2">{value}</p>
    </div>
  );
}
