import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <button className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors">
          + Envoyer une notification
        </button>
      </div>
      {/* TODO: Notification composer (push + SMS), history, recipient targeting */}
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
        Envoyez des notifications push et SMS ciblées à vos participants.
      </div>
    </div>
  );
}
