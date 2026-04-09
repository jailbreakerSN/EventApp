import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Mentions légales | Teranga",
  description:
    "Mentions légales de la plateforme Teranga Events. Informations sur l'éditeur, l'hébergeur et les conditions d'utilisation.",
};

export default function LegalPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft size={16} />
        Retour
      </Link>

      <h1 className="text-3xl font-bold tracking-tight mb-2">
        Mentions l&eacute;gales
      </h1>
      <p className="text-sm text-muted-foreground mb-10">
        Dernière mise à jour : 9 avril 2026
      </p>

      <div className="space-y-8 text-foreground leading-relaxed">
        {/* Éditeur */}
        <section>
          <h2 className="text-xl font-semibold mb-3">1. &Eacute;diteur</h2>
          <p>
            Le site et la plateforme Teranga Events sont édités par :
          </p>
          <ul className="list-none pl-0 mt-3 space-y-1">
            <li>
              <strong>Raison sociale :</strong> Teranga Events
            </li>
            <li>
              <strong>Forme juridique :</strong> [à compléter]
            </li>
            <li>
              <strong>Siège social :</strong> Dakar, Sénégal
            </li>
            <li>
              <strong>NINEA :</strong> [à compléter]
            </li>
            <li>
              <strong>Registre du Commerce :</strong> [à compléter]
            </li>
            <li>
              <strong>Téléphone :</strong> [à compléter]
            </li>
            <li>
              <strong>E-mail :</strong>{" "}
              <a
                href="mailto:contact@teranga.sn"
                className="text-primary hover:underline"
              >
                contact@teranga.sn
              </a>
            </li>
          </ul>
        </section>

        {/* Directeur de la publication */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            2. Directeur de la publication
          </h2>
          <p>
            Le directeur de la publication est : <strong>[à compléter]</strong>,
            en qualité de [à compléter] de Teranga Events.
          </p>
        </section>

        {/* Hébergeur */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            3. H&eacute;bergeur
          </h2>
          <p>Le site est hébergé par :</p>
          <ul className="list-none pl-0 mt-3 space-y-1">
            <li>
              <strong>Raison sociale :</strong> Google LLC
            </li>
            <li>
              <strong>Service :</strong> Google Cloud Platform / Firebase
            </li>
            <li>
              <strong>Siège social :</strong> 1600 Amphitheatre Parkway,
              Mountain View, CA 94043, États-Unis
            </li>
            <li>
              <strong>Site web :</strong>{" "}
              <a
                href="https://cloud.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                cloud.google.com
              </a>
            </li>
          </ul>
          <p className="mt-2">
            Les données sont stockées dans des centres de données situés en
            Europe (région europe-west1), conformément aux clauses contractuelles
            standard de Google relatives à la protection des données.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-xl font-semibold mb-3">4. Contact</h2>
          <p>
            Pour toute question relative au site ou à son contenu, vous pouvez
            nous contacter :
          </p>
          <ul className="list-none pl-0 mt-2 space-y-1">
            <li>
              <strong>E-mail :</strong>{" "}
              <a
                href="mailto:contact@teranga.sn"
                className="text-primary hover:underline"
              >
                contact@teranga.sn
              </a>
            </li>
            <li>
              <strong>Adresse postale :</strong> Teranga Events, Dakar, Sénégal
            </li>
          </ul>
        </section>

        {/* Propriété intellectuelle */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            5. Propri&eacute;t&eacute; intellectuelle
          </h2>
          <p>
            L&apos;ensemble du contenu du site (textes, images, logos,
            graphismes, icônes, logiciels) est la propriété exclusive de Teranga
            Events ou de ses partenaires et est protégé par les lois
            sénégalaises et internationales relatives à la propriété
            intellectuelle. Toute reproduction, représentation, modification,
            publication ou adaptation de tout ou partie du site, quel que soit le
            moyen ou le procédé utilisé, est interdite sans l&apos;autorisation
            écrite préalable de Teranga Events.
          </p>
        </section>

        {/* Liens utiles */}
        <section>
          <h2 className="text-xl font-semibold mb-3">6. Liens utiles</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <Link href="/privacy" className="text-primary hover:underline">
                Politique de confidentialité
              </Link>
            </li>
            <li>
              <Link href="/terms" className="text-primary hover:underline">
                Conditions générales d&apos;utilisation
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
