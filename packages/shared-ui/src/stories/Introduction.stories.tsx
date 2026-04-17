import type { Meta, StoryObj } from "@storybook/react";

/**
 * Landing story for the Teranga shared-ui catalog.
 *
 * Kept intentionally light — deeper documentation lives in
 * `docs/design-system/component-patterns.md` (the authoritative prop-contract
 * source of truth) and the README in this package.
 */
function Introduction() {
  return (
    <div className="mx-auto max-w-[720px] py-10">
      <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark">
        — Teranga Design System
      </p>
      <h1 className="font-serif-display mt-2 text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">
        Catalogue des composants partagés
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
        Cette bibliothèque rassemble les primitives éditoriales (SectionHeader,
        Stepper, OrderSummary, TicketPass, PaymentMethodCard, CapacityBar,
        StatusPill) et les composants cœur (Button, Card, Input, Badge,
        EmptyState, Spinner, ConfirmDialog) utilisés par
        <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">
          apps/web-participant
        </code>
        et
        <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">
          apps/web-backoffice
        </code>
        .
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border p-5">
          <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Contrats de props
          </p>
          <p className="mt-2 text-sm font-semibold">
            docs/design-system/component-patterns.md
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Source de vérité pour les variantes, états et contraintes
            d’accessibilité.
          </p>
        </div>
        <div className="rounded-card border p-5">
          <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Tokens & dark mode
          </p>
          <p className="mt-2 text-sm font-semibold">
            Palette Teranga — navy / or / vert / argile
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Utilisez le sélecteur de thème en haut de la barre d’outils pour
            basculer entre clair et sombre.
          </p>
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof Introduction> = {
  title: "Introduction",
  component: Introduction,
  parameters: {
    layout: "fullscreen",
    a11y: {
      // Landing copy uses gold-dark on cream — passes AA by design, but the
      // axe check on `color-contrast` occasionally flags the cover area in
      // other stories — disable here to avoid false positives.
      disable: false,
    },
  },
};

export default meta;
type Story = StoryObj<typeof Introduction>;

export const Welcome: Story = {};
