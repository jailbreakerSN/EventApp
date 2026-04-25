import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { QueryError } from "../query-error";

const meta: Meta<typeof QueryError> = {
  title: "Core Components/QueryError",
  component: QueryError,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Page-level error surface for failed data fetches (TanStack Query " +
          "errors, SSR failures, network drops). When `onRetry` is provided, " +
          "renders a retry button. Use this for full-page or section-level " +
          "failures; for inline action errors, use `<InlineErrorBanner>` instead.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof QueryError>;

export const Default: Story = {};

export const WithCustomCopy: Story = {
  args: {
    title: "Impossible de charger les inscriptions",
    message:
      "Vérifiez votre connexion ou réessayez dans quelques secondes.",
  },
};

export const WithRetry: Story = {
  args: {
    title: "Erreur réseau",
    message:
      "Le serveur n'a pas répondu à temps. Vous pouvez réessayer la requête.",
    onRetry: () => {},
  },
};

export const InsideContainer: Story = {
  name: "Showcase: inside a card layout",
  render: () => (
    <div className="rounded-card border border-border bg-card p-2">
      <h3 className="px-4 pt-3 text-sm font-medium text-muted-foreground">
        Inscriptions récentes
      </h3>
      <QueryError
        title="Erreur de chargement"
        message="Impossible de charger les 50 dernières inscriptions."
        onRetry={() => {}}
        className="border-0"
      />
    </div>
  ),
};

export const RetryWithLiveState: Story = {
  name: "Showcase: retry counter (live state)",
  render: () => {
    const [retries, setRetries] = useState(0);
    return (
      <div className="space-y-2">
        <QueryError
          title={retries === 0 ? "Erreur de chargement" : `Tentative #${retries + 1} échouée`}
          message="Cliquez pour relancer la requête. Chaque clic incrémente le compteur."
          onRetry={() => setRetries((n) => n + 1)}
        />
        <p className="text-xs text-muted-foreground" role="status">
          {retries} retry(s) tenté(s).
        </p>
      </div>
    );
  },
};
