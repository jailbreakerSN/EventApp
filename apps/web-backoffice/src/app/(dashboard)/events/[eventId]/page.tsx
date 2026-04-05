import type { Metadata } from "next";

export const metadata: Metadata = { title: "Détail de l'événement" };

export default function EventDetailPage({ params }: { params: { eventId: string } }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Détail de l&apos;événement</h1>
      {/* TODO: Event detail with tabs: Info, Programme, Participants, Badges, Statistiques */}
      <p className="text-gray-500">Event ID: {params.eventId}</p>
    </div>
  );
}
