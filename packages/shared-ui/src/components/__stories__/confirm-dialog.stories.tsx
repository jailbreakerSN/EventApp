import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ConfirmDialog } from "../confirm-dialog";
import { Button } from "../button";

const meta: Meta<typeof ConfirmDialog> = {
  title: "Core Components/ConfirmDialog",
  component: ConfirmDialog,
  tags: ["autodocs"],
  parameters: {
    // Native <dialog> uses the top layer — give axe a bit more breathing room.
    layout: "centered",
  },
};
export default meta;

type Story = StoryObj<typeof ConfirmDialog>;

function Demo({ variant }: { variant: "default" | "danger" }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Rouvrir la boîte de dialogue
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        title={
          variant === "danger"
            ? "Annuler votre inscription ?"
            : "Confirmer l’action"
        }
        description={
          variant === "danger"
            ? "Cette action est irréversible. Votre place sera libérée et le remboursement lancé sous 5 jours ouvrés."
            : "Vérifiez les informations avant de continuer."
        }
        confirmLabel={variant === "danger" ? "Oui, annuler" : "Confirmer"}
        cancelLabel="Retour"
        variant={variant}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <Demo variant="default" />,
};

export const Danger: Story = {
  render: () => <Demo variant="danger" />,
};
