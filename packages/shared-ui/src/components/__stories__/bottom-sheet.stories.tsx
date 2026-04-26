import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import type { JSX } from "react";
import { BottomSheet, BottomSheetBody, BottomSheetFooter } from "../bottom-sheet";
import { FiltersBottomSheet } from "../filters-bottom-sheet";
import { Button } from "../button";

const meta: Meta = {
  title: "Core Components/BottomSheet",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Mobile-first bottom sheet from the data-listing doctrine. Slides up from the bottom on small screens, falls back to a centered modal on `md:` and up. Backed by the native `<dialog>` element so it inherits a real focus trap, ESC dismissal, and the built-in `::backdrop` pseudo-element without an extra library.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

// Stories that auto-open on mount so the visual-regression baseline
// captures the open state. The internal Demo component holds the open
// state local to the story; tapping the backdrop or pressing ESC re-opens
// it via the useEffect to keep the story idempotent across HMR re-mounts.

function OpenOnMount({ children }: { children: (open: boolean, setOpen: (v: boolean) => void) => JSX.Element }): JSX.Element {
  const [open, setOpen] = React.useState(true);
  // Storybook HMR can preserve state across re-renders; force-open on mount
  // so the snapshot always captures the open frame.
  React.useEffect(() => {
    setOpen(true);
  }, []);
  return children(open, setOpen);
}

export const BasicSheet: Story = {
  name: "Basic — title + body + footer",
  render: () => (
    <OpenOnMount>
      {(open, setOpen) => (
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          title="Détails de la commande"
          description="3 articles · 12 500 XOF"
        >
          <BottomSheetBody>
            <p className="text-sm text-foreground">
              Le contenu défilable du bottom sheet vit ici. Sur mobile, la feuille s'ouvre du bas et
              se ferme au tap de l'arrière-plan ou en glissant vers le bas. Sur desktop, le sheet
              bascule en mode modal centré.
            </p>
          </BottomSheetBody>
          <BottomSheetFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => setOpen(false)}>Confirmer</Button>
          </BottomSheetFooter>
        </BottomSheet>
      )}
    </OpenOnMount>
  ),
};

export const FiltersSheetWithCount: Story = {
  name: "FiltersBottomSheet — live count + clear-all",
  render: () => (
    <OpenOnMount>
      {(open, setOpen) => (
        <FiltersBottomSheet
          open={open}
          onOpenChange={setOpen}
          description="3 filtres actifs"
          liveCount={14}
          onApply={() => setOpen(false)}
          onClearAll={() => undefined}
        >
          <FilterGroup label="Date">
            <ChipRow options={["Aujourd'hui", "Cette semaine", "Ce week-end", "Ce mois-ci"]} />
          </FilterGroup>
          <FilterGroup label="Catégorie">
            <ChipRow options={["Conférence", "Atelier", "Concert", "Festival", "Networking"]} />
          </FilterGroup>
          <FilterGroup label="Format">
            <ChipRow options={["Présentiel", "En ligne", "Hybride"]} />
          </FilterGroup>
          <FilterGroup label="Prix">
            <ChipRow options={["Gratuit", "Payant"]} />
          </FilterGroup>
        </FiltersBottomSheet>
      )}
    </OpenOnMount>
  ),
};

export const FiltersSheetEmpty: Story = {
  name: "FiltersBottomSheet — no matches (CTA disabled)",
  render: () => (
    <OpenOnMount>
      {(open, setOpen) => (
        <FiltersBottomSheet
          open={open}
          onOpenChange={setOpen}
          description="5 filtres actifs"
          liveCount={0}
          onApply={() => setOpen(false)}
          onClearAll={() => undefined}
        >
          <FilterGroup label="Catégorie">
            <ChipRow options={["Cérémonie"]} active={[0]} />
          </FilterGroup>
          <p className="text-sm text-muted-foreground">
            Le CTA passe en état désactivé quand aucun événement ne correspond aux filtres
            sélectionnés. L'utilisateur peut toujours fermer le sheet via la croix ou la
            touche ESC.
          </p>
        </FiltersBottomSheet>
      )}
    </OpenOnMount>
  ),
};

// ─── Local presentation helpers ──────────────────────────────────────────

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function ChipRow({ options, active = [] }: { options: string[]; active?: number[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt, i) => (
        <span
          key={opt}
          className={
            active.includes(i)
              ? "rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium"
              : "rounded-full bg-muted text-muted-foreground px-3 py-1 text-xs font-medium"
          }
        >
          {opt}
        </span>
      ))}
    </div>
  );
}
