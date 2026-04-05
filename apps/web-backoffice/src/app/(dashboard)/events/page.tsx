import type { Metadata } from "next";

export const metadata: Metadata = { title: "Événements" };

export default function EventsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Événements</h1>
        <button className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors">
          + Créer un événement
        </button>
      </div>
      {/* TODO: Event list with search, filters, and pagination */}
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
        Aucun événement pour le moment. Créez votre premier événement.
      </div>
    </div>
  );
}
