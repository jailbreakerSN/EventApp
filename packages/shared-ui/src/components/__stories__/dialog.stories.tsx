import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../dialog";
import { Button } from "../button";
import { Input } from "../input";
import { FormField } from "../form-field";

const meta: Meta = {
  title: "Core Components/Dialog",
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Controlled modal dialog with ARIA-correct title/description ids, focus " +
          "trapping, ESC-to-close, and a close affordance. The whole thing is " +
          "keyboard-navigable and screen-reader-friendly out of the box. Use the " +
          "wrappers (`DialogHeader`/`DialogTitle`/etc.) for consistent spacing.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

export const ConfirmDestructive: Story = {
  name: "Confirm: destructive action",
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Archiver l'événement
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archiver « Dakar Tech Summit 2026 » ?</DialogTitle>
              <DialogDescription>
                L'événement sera masqué du public. Vous avez 30 jours pour le
                restaurer avant suppression définitive du flux principal.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button variant="destructive" onClick={() => setOpen(false)}>
                Archiver
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
};

export const FormInDialog: Story = {
  name: "Form: rename event",
  render: () => {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("Dakar Tech Summit 2026");
    return (
      <>
        <Button onClick={() => setOpen(true)}>Renommer l'événement</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Renommer l'événement</DialogTitle>
              <DialogDescription>
                Le slug public ne change pas automatiquement — vous pourrez le
                modifier sur la page de détail si nécessaire.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4">
              <FormField label="Nouveau titre" htmlFor="event-title-rename">
                <Input
                  id="event-title-rename"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FormField>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button onClick={() => setOpen(false)}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
};

export const InfoOnly: Story = {
  name: "Info-only (no action)",
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Voir les détails
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent closeLabel="Fermer">
            <DialogHeader>
              <DialogTitle>Politique de remboursement</DialogTitle>
              <DialogDescription>
                Les remboursements sont possibles jusqu'à 48 h avant le début
                de l'événement. Au-delà, contactez l'organisateur.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </>
    );
  },
};
