import type { Metadata } from "next";

export const metadata: Metadata = { title: "Analytiques" };

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytiques</h1>
      {/* TODO: Charts for registrations over time, check-in rate, ticket types, real-time dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard label="Taux de check-in" value="—%" />
        <StatCard label="Inscriptions cette semaine" value="—" />
        <StatCard label="Revenus (XOF)" value="—" />
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
        Les graphiques s&apos;afficheront une fois vos événements actifs.
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
