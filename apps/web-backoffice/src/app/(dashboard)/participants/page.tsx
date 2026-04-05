import type { Metadata } from "next";

export const metadata: Metadata = { title: "Participants" };

export default function ParticipantsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Participants</h1>
      {/* TODO: Participant table with search, export CSV, status filters (confirmed/waitlisted/checked-in) */}
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
        Sélectionnez un événement pour voir ses participants.
      </div>
    </div>
  );
}
