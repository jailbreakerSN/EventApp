import type { Metadata } from "next";
import { Users, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = { title: "Participants" };

export default async function ParticipantsPage() {
  const _t = await getTranslations("common"); void _t;
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-6">Participants</h1>
      <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center text-center">
        <div className="bg-muted rounded-full p-4 mb-4">
          <Users className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Aucun événement sélectionné
        </h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          Sélectionnez un événement pour voir ses participants, gérer les inscriptions et exporter les données au format CSV.
        </p>
        <Link
          href="/events"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Voir mes événements
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
