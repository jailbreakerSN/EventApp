import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, HelpCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Aide & FAQ | Teranga",
  description:
    "Réponses aux questions fréquentes sur Teranga Events : inscriptions, billets, QR badges, remboursements et plus.",
};

export default async function FaqPage() {
  const _t = await getTranslations("common"); void _t;
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
        <HelpCircle className="h-8 w-8 text-teranga-gold" />
        <h1 className="text-3xl font-bold tracking-tight">Aide & FAQ</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-10">
        Réponses aux questions fréquentes sur la plateforme
      </p>

      <div className="space-y-8 text-foreground leading-relaxed">
        <section className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6">
          <h2 className="text-xl font-semibold mb-3">Bientôt disponible</h2>
          <p className="text-muted-foreground">
            Nous préparons une FAQ complète pour répondre à toutes vos questions sur les
            inscriptions, les paiements, les QR badges et plus encore.
          </p>
          <p className="text-muted-foreground mt-3">
            En attendant, n&apos;hésitez pas à nous contacter si vous avez des questions :{" "}
            <a href="mailto:contact@teranga.sn" className="text-primary hover:underline">
              contact@teranga.sn
            </a>
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Sections à venir</h2>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>Comment m&apos;inscrire à un événement&nbsp;?</li>
            <li>Comment fonctionne le QR badge&nbsp;?</li>
            <li>Puis-je annuler mon inscription&nbsp;?</li>
            <li>Comment contacter l&apos;organisateur&nbsp;?</li>
            <li>Paiements et remboursements</li>
            <li>Que faire si je ne reçois pas mon email de confirmation&nbsp;?</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
