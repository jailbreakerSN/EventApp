import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectionHeader } from "@teranga/shared-ui";

export const metadata: Metadata = {
  title: "Conditions d'utilisation | Teranga",
  description:
    "Conditions générales d'utilisation de la plateforme Teranga Events. Règles d'inscription, paiements, responsabilités et droit applicable.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        Retour
      </Link>

      <SectionHeader
        kicker="— CONDITIONS"
        title="Conditions générales d'utilisation"
        subtitle="Dernière mise à jour : 9 avril 2026."
        size="hero"
        as="h1"
      />

      <div className="space-y-8 text-foreground leading-relaxed">
        {/* Objet et acceptation */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            1. Objet et acceptation
          </h2>
          <p>
            Les présentes conditions générales d&apos;utilisation (ci-après
            &laquo;&nbsp;CGU&nbsp;&raquo;) régissent l&apos;accès et
            l&apos;utilisation de la plateforme Teranga Events (ci-après
            &laquo;&nbsp;la Plateforme&nbsp;&raquo;), accessible via le site web
            et les applications mobiles. En créant un compte ou en utilisant la
            Plateforme, vous acceptez sans réserve les présentes CGU.
          </p>
        </section>

        {/* Inscription et compte */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            2. Inscription et compte
          </h2>
          <p className="mb-2">
            L&apos;inscription est gratuite et ouverte à toute personne physique
            majeure ou morale. Vous pouvez créer un compte via :
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Une adresse e-mail et un mot de passe sécurisé.
            </li>
            <li>
              Un compte Google (authentification tierce).
            </li>
          </ul>
          <p className="mt-2">
            Vous êtes responsable de la confidentialité de vos identifiants de
            connexion et de toute activité effectuée depuis votre compte. En cas
            d&apos;accès non autorisé, vous devez nous en informer
            immédiatement.
          </p>
        </section>

        {/* Rôles */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            3. Rôles sur la Plateforme
          </h2>
          <p className="mb-2">
            La Plateforme distingue plusieurs rôles d&apos;utilisateurs :
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Participant :</strong> personne qui s&apos;inscrit et
              assiste à des événements.
            </li>
            <li>
              <strong>Organisateur :</strong> personne ou organisation qui crée
              et gère des événements sur la Plateforme.
            </li>
            <li>
              <strong>Speaker (intervenant) :</strong> personne invitée à
              intervenir lors d&apos;un événement.
            </li>
            <li>
              <strong>Sponsor :</strong> entreprise ou personne qui soutient
              financièrement un événement en échange de visibilité.
            </li>
          </ul>
          <p className="mt-2">
            Chaque rôle est associé à des permissions spécifiques d&apos;accès
            et d&apos;action sur la Plateforme.
          </p>
        </section>

        {/* Utilisation */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            4. Utilisation de la Plateforme
          </h2>
          <p className="mb-2">Vous vous engagez à :</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Fournir des informations exactes et à jour lors de votre
              inscription et de la création d&apos;événements.
            </li>
            <li>
              Ne pas utiliser la Plateforme à des fins illicites, frauduleuses ou
              contraires aux bonnes moeurs.
            </li>
            <li>
              Ne pas tenter d&apos;accéder aux données d&apos;autres
              utilisateurs de manière non autorisée.
            </li>
            <li>
              Ne pas reproduire, copier ou revendre tout ou partie de la
              Plateforme sans autorisation écrite.
            </li>
            <li>
              Respecter les droits des autres utilisateurs, notamment les
              organisateurs et les participants.
            </li>
          </ul>
          <p className="mt-2">
            Tout manquement à ces obligations peut entraîner la suspension ou la
            suppression de votre compte.
          </p>
        </section>

        {/* Billets et paiements */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            5. Billets et paiements
          </h2>
          <p className="mb-2">
            Les prix des billets sont fixés par les organisateurs et affichés en
            francs CFA (XOF). Les paiements sont traités via les prestataires de
            paiement mobile suivants :
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Wave</li>
            <li>Orange Money</li>
          </ul>
          <p className="mt-2">
            Teranga Events agit en qualité d&apos;intermédiaire technique pour
            le traitement des paiements. Les fonds sont reversés aux
            organisateurs selon les conditions convenues.
          </p>
          <p className="mt-2">
            <strong>Remboursements :</strong> la politique de remboursement est
            définie par chaque organisateur. En cas de litige, Teranga Events
            pourra intervenir en tant que médiateur, mais la décision finale
            appartient à l&apos;organisateur de l&apos;événement.
            L&apos;annulation d&apos;un événement par l&apos;organisateur
            entraîne le remboursement intégral des participants.
          </p>
        </section>

        {/* Propriété intellectuelle */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            6. Propri&eacute;t&eacute; intellectuelle
          </h2>
          <p>
            La Plateforme, son code source, son design, ses logos et ses
            contenus éditoriaux sont la propriété exclusive de Teranga Events.
            Toute reproduction, représentation ou exploitation non autorisée est
            interdite. Les contenus publiés par les utilisateurs (descriptions
            d&apos;événements, images) restent la propriété de leurs auteurs,
            qui accordent à Teranga Events une licence non exclusive de diffusion
            sur la Plateforme.
          </p>
        </section>

        {/* Responsabilités */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">7. Responsabilités</h2>
          <p className="mb-2">
            <strong>Teranga Events en tant qu&apos;intermédiaire
            technique :</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              La Plateforme met en relation les organisateurs et les
              participants. Teranga Events n&apos;est pas l&apos;organisateur
              des événements et ne saurait être tenu responsable de leur
              déroulement, de leur annulation ou de leur contenu.
            </li>
            <li>
              Teranga Events s&apos;efforce d&apos;assurer la disponibilité de
              la Plateforme, mais ne garantit pas un fonctionnement ininterrompu.
              Des interruptions pour maintenance sont possibles.
            </li>
            <li>
              En aucun cas Teranga Events ne pourra être tenu responsable des
              dommages indirects résultant de l&apos;utilisation de la
              Plateforme.
            </li>
          </ul>
        </section>

        {/* Données personnelles */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            8. Donn&eacute;es personnelles
          </h2>
          <p>
            Le traitement de vos données personnelles est régi par notre{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Politique de confidentialité
            </Link>
            , qui fait partie intégrante des présentes CGU.
          </p>
        </section>

        {/* Modification des conditions */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            9. Modification des conditions
          </h2>
          <p>
            Teranga Events se réserve le droit de modifier les présentes CGU à
            tout moment. Les modifications entrent en vigueur dès leur
            publication sur la Plateforme. Vous serez informé(e) par e-mail des
            modifications substantielles. La poursuite de l&apos;utilisation de
            la Plateforme après modification vaut acceptation des nouvelles
            conditions.
          </p>
        </section>

        {/* Droit applicable */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">10. Droit applicable</h2>
          <p>
            Les présentes CGU sont soumises au droit sénégalais. En cas de
            litige relatif à leur interprétation ou à leur exécution, les
            parties s&apos;efforceront de trouver une solution amiable. À défaut,
            les tribunaux de Dakar (Sénégal) seront seuls compétents.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">11. Contact</h2>
          <p>
            Pour toute question relative aux présentes conditions, vous pouvez
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
              <strong>Adresse :</strong> Teranga Events, Dakar, Sénégal
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
