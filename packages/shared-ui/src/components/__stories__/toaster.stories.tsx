import type { Meta, StoryObj } from "@storybook/react";
import { toast } from "sonner";
import { Toaster } from "../toaster";
import { Button } from "../button";

const meta: Meta<typeof Toaster> = {
  title: "Core Components/Toaster",
  component: Toaster,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Renders the Sonner toast portal. Trigger toasts from anywhere with " +
          "the exported `toast.success / toast.error / toast()` API. **Use toasts " +
          "for transient confirmations and non-blocking errors only.** Blocking " +
          "errors (form submission failures, etc.) belong in `<InlineErrorBanner>` " +
          "— see the error-handling design doc.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Toaster>;

export const Success: Story = {
  render: () => (
    <>
      <Toaster />
      <Button onClick={() => toast.success("Inscription confirmée")}>
        Toast succès
      </Button>
    </>
  ),
};

export const Error: Story = {
  render: () => (
    <>
      <Toaster />
      <Button
        variant="outline"
        onClick={() => toast.error("Une erreur est survenue lors de l'envoi")}
      >
        Toast erreur
      </Button>
    </>
  ),
};

export const Info: Story = {
  render: () => (
    <>
      <Toaster />
      <Button variant="ghost" onClick={() => toast("Modifications enregistrées")}>
        Toast info
      </Button>
    </>
  ),
};

export const WithDescription: Story = {
  name: "Title + description",
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() =>
          toast.success("Badge généré", {
            description: "Le PDF est disponible dans « Mes inscriptions ».",
          })
        }
      >
        Avec description
      </Button>
    </>
  ),
};

export const WithAction: Story = {
  name: "Action button (undo)",
  render: () => (
    <>
      <Toaster />
      <Button
        variant="outline"
        onClick={() =>
          toast("Inscription annulée", {
            description: "Vous pouvez la rétablir dans les 30 secondes.",
            action: {
              label: "Annuler",
              onClick: () => toast.success("Inscription rétablie"),
            },
          })
        }
      >
        Annuler une inscription
      </Button>
    </>
  ),
};

function makeAsyncFakeWork(): Promise<string> {
  return new Promise<string>((resolve, reject) =>
    setTimeout(
      () =>
        Math.random() < 0.5 ? resolve("Badge généré") : reject("Échec"),
      1500,
    ),
  );
}

export const PromiseDriven: Story = {
  name: "Promise-driven toast (loading → success/error)",
  render: () => (
    <>
      <Toaster />
      <Button
        onClick={() => {
          toast.promise(makeAsyncFakeWork(), {
            loading: "Génération du badge en cours…",
            success: (msg: string) => msg,
            error: (e: unknown) => `Erreur : ${String(e)}`,
          });
        }}
      >
        Lancer une opération asynchrone
      </Button>
    </>
  ),
};

export const Showcase: Story = {
  name: "Showcase: trigger panel",
  parameters: { layout: "padded" },
  render: () => (
    <>
      <Toaster />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toast.success("✓ Succès")}>Succès</Button>
        <Button variant="outline" onClick={() => toast.error("Erreur générique")}>
          Erreur
        </Button>
        <Button variant="ghost" onClick={() => toast("Information neutre")}>
          Info
        </Button>
        <Button variant="ghost" onClick={() => toast.warning?.("Attention requise")}>
          Avertissement
        </Button>
      </div>
    </>
  ),
};
