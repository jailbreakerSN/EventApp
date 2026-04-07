import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <button className="bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors">
          + Envoyer une notification
        </button>
      </div>
      {/* TODO: Notification composer (push + SMS), history, recipient targeting */}
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        Envoyez des notifications push et SMS ciblées à vos participants.
      </div>
    </div>
  );
}
