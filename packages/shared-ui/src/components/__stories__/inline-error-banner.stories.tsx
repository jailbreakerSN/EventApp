import type { Meta, StoryObj } from "@storybook/react";
import { InlineErrorBanner } from "../inline-error-banner";

const meta: Meta<typeof InlineErrorBanner> = {
  title: "Core Components/InlineErrorBanner",
  component: InlineErrorBanner,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Persistent, **blocking** error feedback for failures the user must " +
          "address. Renders `role=\"alert\"` and `aria-live=\"assertive\"` for the " +
          "destructive variant (announce immediately), `polite` for warning/info. " +
          "Use this — not a transient toast — when a submission fails and the " +
          "user needs a path forward. See `docs/design-system/error-handling.md`.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof InlineErrorBanner>;

export const Destructive: Story = {
  args: {
    title: "Impossible de publier l'événement",
    description: "Aucune date de fin n'est renseignée.",
    severity: "destructive",
  },
};

export const Warning: Story = {
  args: {
    title: "Limite du plan atteinte",
    description: "Vous avez utilisé toutes vos inscriptions ce mois-ci.",
    severity: "warning",
    actions: [{ label: "Voir mon plan", href: "/billing", primary: true }],
  },
};

export const Info: Story = {
  args: {
    title: "Information",
    description: "Cette opération est réversible pendant 30 jours.",
    severity: "info",
  },
};

export const WithKicker: Story = {
  args: {
    kicker: "Impossible de s'inscrire",
    title: "L'événement est complet",
    description:
      "Toutes les places ont été attribuées. Une liste d'attente est disponible.",
    severity: "warning",
    actions: [{ label: "Rejoindre la liste", onClick: () => {}, primary: true }],
  },
};

export const WithMultipleActions: Story = {
  args: {
    title: "Conflit avec une autre inscription",
    description:
      "Vous êtes déjà inscrit à un événement qui chevauche les horaires de celui-ci.",
    severity: "destructive",
    actions: [
      { label: "Voir mes inscriptions", href: "/me", primary: true },
      { label: "Annuler l'autre", onClick: () => {} },
      { label: "Continuer quand même", onClick: () => {} },
    ],
  },
};

export const Dismissible: Story = {
  args: {
    title: "Sauvegarde automatique désactivée",
    description: "Vos modifications devront être enregistrées manuellement.",
    severity: "info",
    onDismiss: () => {},
    dismissLabel: "Fermer",
  },
};

export const Showcase: Story = {
  name: "Showcase: stacked severities",
  render: () => (
    <div className="flex flex-col gap-3">
      <InlineErrorBanner
        title="Inscription bloquée — événement passé"
        description="Cet événement s'est terminé il y a 3 jours."
        severity="destructive"
      />
      <InlineErrorBanner
        title="Plan Free — fonctionnalité indisponible"
        description="Les notifications SMS nécessitent le plan Pro ou supérieur."
        severity="warning"
        actions={[
          { label: "Comparer les plans", href: "/billing", primary: true },
          { label: "Plus tard", onClick: () => {} },
        ]}
      />
      <InlineErrorBanner
        title="Mode hors-ligne"
        description="Vous reprendrez la synchronisation au retour de la connexion."
        severity="info"
      />
    </div>
  ),
};
