import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Tag } from "lucide-react";

export const metadata: Metadata = {
  title: "Tarification | Teranga",
  description:
    "Plans et tarifs Teranga Events pour les organisateurs : Free, Starter, Pro et Enterprise.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft size={16} />
        Retour
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Tag className="h-8 w-8 text-teranga-gold" />
        <h1 className="text-3xl font-bold tracking-tight">Tarification</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-10">
        Plans et tarifs pour les organisateurs d&apos;événements
      </p>

      <div className="space-y-8 text-foreground leading-relaxed">
        <section className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6">
          <h2 className="text-xl font-semibold mb-3">Bientôt disponible</h2>
          <p className="text-muted-foreground">
            Nous finalisons notre grille tarifaire publique. Teranga Events propose quatre plans
            pour les organisateurs, du plan gratuit (jusqu&apos;à 3 événements) au plan Enterprise
            sur mesure.
          </p>
          <p className="text-muted-foreground mt-3">
            Pour plus d&apos;informations sur les plans Starter, Pro et Enterprise, contactez-nous :{" "}
            <a href="mailto:contact@teranga.sn" className="text-primary hover:underline">
              contact@teranga.sn
            </a>
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Aperçu des plans</h2>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Free</strong> — Jusqu&apos;à 3&nbsp;événements,
              50&nbsp;participants par événement
            </li>
            <li>
              <strong className="text-foreground">Starter</strong> — 9&thinsp;900&thinsp;XOF/mois,
              10&nbsp;événements, scanning QR et codes promo
            </li>
            <li>
              <strong className="text-foreground">Pro</strong> — 29&thinsp;900&thinsp;XOF/mois,
              événements illimités, billets payants, analytics avancés, SMS
            </li>
            <li>
              <strong className="text-foreground">Enterprise</strong> — Sur mesure, API, marque
              blanche, support prioritaire
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
