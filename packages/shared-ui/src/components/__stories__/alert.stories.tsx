import type { Meta, StoryObj } from "@storybook/react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../alert";

const meta: Meta<typeof Alert> = {
  title: "Core Components/Alert",
  component: Alert,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Persistent, accessible inline status surface. Use for non-blocking " +
          "confirmations or hints that the user should see but not have to dismiss. " +
          "For blocking errors that require a fix, prefer `<InlineErrorBanner>` — see " +
          "`docs/design-system/error-handling.md`.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Alert>;

export const Default: Story = {
  render: () => (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>Information</AlertTitle>
      <AlertDescription>
        Votre événement sera publié dès la fin de la révision.
      </AlertDescription>
    </Alert>
  ),
};

export const Success: Story = {
  render: () => (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>Inscription confirmée</AlertTitle>
      <AlertDescription>
        Votre badge est prêt à être téléchargé depuis « Mes inscriptions ».
      </AlertDescription>
    </Alert>
  ),
};

export const Warning: Story = {
  render: () => (
    <Alert variant="warning">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>Limite du plan atteinte</AlertTitle>
      <AlertDescription>
        Vous avez utilisé 95 % de vos inscriptions ce mois-ci. Passez au plan
        Starter pour étendre votre quota à 200 participants par événement.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>Erreur de publication</AlertTitle>
      <AlertDescription>
        Impossible de publier l'événement : aucune date de fin n'est renseignée.
        Corrigez le formulaire avant de réessayer.
      </AlertDescription>
    </Alert>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>Modifications enregistrées.</AlertTitle>
    </Alert>
  ),
};

export const NoIcon: Story = {
  render: () => (
    <Alert>
      <AlertTitle>Astuce</AlertTitle>
      <AlertDescription>
        Activez la sauvegarde automatique pour ne plus jamais perdre vos
        modifications. Ce mode peut être désactivé à tout moment.
      </AlertDescription>
    </Alert>
  ),
};

export const Showcase: Story = {
  name: "Showcase: All variants stacked",
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex flex-col gap-3">
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>Information</AlertTitle>
        <AlertDescription>Variant: <code>default</code> — neutral tone for hints.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <CheckCircle2 aria-hidden="true" />
        <AlertTitle>Succès</AlertTitle>
        <AlertDescription>Variant: <code>success</code> — confirmation positive.</AlertDescription>
      </Alert>
      <Alert variant="warning">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Avertissement</AlertTitle>
        <AlertDescription>Variant: <code>warning</code> — attention requise mais non bloquant.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Erreur</AlertTitle>
        <AlertDescription>Variant: <code>destructive</code> — action utilisateur requise.</AlertDescription>
      </Alert>
    </div>
  ),
};
