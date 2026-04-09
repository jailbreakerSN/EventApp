import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Politique de confidentialité | Teranga",
  description:
    "Politique de confidentialité de la plateforme Teranga Events. Découvrez comment nous collectons, utilisons et protégeons vos données personnelles.",
};

export default function PrivacyPage() {
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
        Politique de confidentialité
      </h1>
      <p className="text-sm text-muted-foreground mb-10">
        Dernière mise à jour : 9 avril 2026
      </p>

      <div className="space-y-8 text-foreground leading-relaxed">
        <p>
          Teranga Events (&laquo;&nbsp;nous&nbsp;&raquo;,
          &laquo;&nbsp;notre&nbsp;&raquo;, &laquo;&nbsp;la
          plateforme&nbsp;&raquo;) s&apos;engage à protéger la vie privée de
          ses utilisateurs. La présente politique décrit les données que nous
          collectons, la manière dont nous les utilisons et les droits dont vous
          disposez.
        </p>

        {/* Données collectées */}
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Données collectées</h2>
          <p className="mb-2">
            Nous collectons les catégories de données suivantes :
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Données d&apos;identification :</strong> nom, prénom,
              adresse e-mail, numéro de téléphone.
            </li>
            <li>
              <strong>Données de compte :</strong> identifiant Firebase,
              méthode de connexion (e-mail/mot de passe ou Google).
            </li>
            <li>
              <strong>Données de paiement :</strong> informations de transaction
              via Wave ou Orange Money. Nous ne stockons pas vos identifiants de
              paiement mobile ; les transactions sont traitées directement par
              ces prestataires.
            </li>
            <li>
              <strong>Données d&apos;utilisation :</strong> pages consultées,
              événements auxquels vous vous inscrivez, horodatages de connexion.
            </li>
            <li>
              <strong>Données techniques :</strong> adresse IP, type de
              navigateur, système d&apos;exploitation, identifiant d&apos;appareil.
            </li>
          </ul>
        </section>

        {/* Utilisation des données */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            2. Utilisation des données
          </h2>
          <p className="mb-2">Vos données sont utilisées pour :</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Créer et gérer votre compte utilisateur.</li>
            <li>
              Traiter vos inscriptions aux événements et générer vos badges QR.
            </li>
            <li>
              Traiter les paiements de billets via les prestataires de paiement
              mobile.
            </li>
            <li>
              Vous envoyer des communications relatives aux événements
              (confirmations, rappels, mises à jour).
            </li>
            <li>
              Améliorer la plateforme grâce à l&apos;analyse
              d&apos;utilisation anonymisée.
            </li>
            <li>
              Assurer la sécurité de la plateforme et prévenir les fraudes.
            </li>
          </ul>
        </section>

        {/* Partage des données */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            3. Partage des données
          </h2>
          <p className="mb-2">
            Nous ne vendons jamais vos données personnelles. Nous les partageons
            uniquement dans les cas suivants :
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Organisateurs d&apos;événements :</strong> lorsque vous
              vous inscrivez à un événement, l&apos;organisateur reçoit votre
              nom et votre adresse e-mail afin de gérer votre participation.
            </li>
            <li>
              <strong>Prestataires de paiement :</strong> Wave et Orange Money
              reçoivent les données nécessaires au traitement de vos
              transactions.
            </li>
            <li>
              <strong>Hébergeur :</strong> nos données sont hébergées sur Google
              Cloud Platform (Firebase), soumis aux clauses contractuelles
              standard de Google.
            </li>
            <li>
              <strong>Obligations légales :</strong> nous pouvons divulguer vos
              données si la loi sénégalaise l&apos;exige.
            </li>
          </ul>
        </section>

        {/* Cookies */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            4. Cookies et technologies similaires
          </h2>
          <p>
            Nous utilisons des cookies strictement nécessaires au fonctionnement
            de la plateforme (authentification, préférences de session). Nous
            utilisons Firebase Analytics pour mesurer l&apos;audience de manière
            anonymisée. Nous n&apos;utilisons pas de cookies publicitaires ni de
            traceurs tiers.
          </p>
        </section>

        {/* Durée de conservation */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            5. Durée de conservation
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Données de compte :</strong> conservées tant que votre
              compte est actif. En cas de suppression de compte, vos données
              sont anonymisées sous 30 jours.
            </li>
            <li>
              <strong>Données d&apos;inscription :</strong> conservées pendant 2
              ans après l&apos;événement à des fins de facturation et de
              statistiques.
            </li>
            <li>
              <strong>Données de paiement :</strong> conservées pendant la durée
              légale requise par la réglementation financière sénégalaise (10
              ans).
            </li>
            <li>
              <strong>Journaux techniques :</strong> supprimés automatiquement
              après 90 jours.
            </li>
          </ul>
        </section>

        {/* Vos droits */}
        <section>
          <h2 className="text-xl font-semibold mb-3">6. Vos droits</h2>
          <p className="mb-2">
            Conformément à la loi sénégalaise n&deg;&nbsp;2008-12 sur la
            protection des données personnelles et au Règlement Général sur la
            Protection des Données (RGPD), vous disposez des droits suivants :
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Droit d&apos;accès :</strong> obtenir une copie de vos
              données personnelles.
            </li>
            <li>
              <strong>Droit de rectification :</strong> corriger des données
              inexactes ou incomplètes.
            </li>
            <li>
              <strong>Droit de suppression :</strong> demander
              l&apos;effacement de vos données, sous réserve des obligations
              légales de conservation.
            </li>
            <li>
              <strong>Droit à la portabilité :</strong> recevoir vos données
              dans un format structuré et lisible par machine.
            </li>
            <li>
              <strong>Droit d&apos;opposition :</strong> vous opposer au
              traitement de vos données à des fins de prospection.
            </li>
          </ul>
          <p className="mt-2">
            Pour exercer ces droits, contactez-nous à l&apos;adresse indiquée
            ci-dessous.
          </p>
        </section>

        {/* Sécurité */}
        <section>
          <h2 className="text-xl font-semibold mb-3">
            7. Sécurité des données
          </h2>
          <p>
            Nous mettons en oeuvre des mesures techniques et organisationnelles
            appropriées pour protéger vos données : chiffrement en transit
            (TLS), authentification sécurisée via Firebase Authentication,
            contrôle d&apos;accès basé sur les rôles (RBAC), et signatures
            cryptographiques HMAC-SHA256 pour les badges QR. L&apos;accès aux
            données de production est restreint au personnel autorisé.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-xl font-semibold mb-3">8. Contact</h2>
          <p>
            Pour toute question relative à cette politique de confidentialité ou
            pour exercer vos droits, vous pouvez nous contacter :
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
