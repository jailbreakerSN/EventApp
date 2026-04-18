import type { Meta, StoryObj } from "@storybook/react";
import { Bookmark, CalendarCheck2, Sparkles } from "lucide-react";
import { EmptyStateEditorial } from "../empty-state-editorial";
import { Button } from "../button";

const meta: Meta<typeof EmptyStateEditorial> = {
  title: "Editorial Primitives/EmptyStateEditorial",
  component: EmptyStateEditorial,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  render: (args) => (
    <div style={{ width: 720 }}>
      <EmptyStateEditorial {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof EmptyStateEditorial>;

/**
 * Saved tab empty state from `/my-events`. Kicker + Fraunces title +
 * discover CTA. Icon omitted so the heart/star feel comes from the
 * voice of the copy itself.
 */
export const SavedEmpty: Story = {
  name: "Saved tab · primary CTA",
  args: {
    kicker: "— RIEN EN ATTENTE",
    title: "Aucun événement sauvegardé pour l’instant",
    description:
      "Parcourez la programmation Teranga et ajoutez à votre liste les rencontres que vous voulez retrouver plus tard.",
    action: (
      <Button className="rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90">
        Découvrir des événements
      </Button>
    ),
    icon: Bookmark,
  },
};

/**
 * Past tab empty state. No action — the participant has simply not
 * attended anything yet, so we close the conversation warmly.
 */
export const PastEmpty: Story = {
  name: "Past tab · no CTA",
  args: {
    kicker: "— À VENIR",
    title: "Votre historique commencera ici",
    description:
      "Après votre première rencontre Teranga, les événements que vous avez vécus apparaîtront dans cet onglet.",
    icon: CalendarCheck2,
  },
};

/**
 * Minimal variant — title only. Useful inline on dense dashboards where
 * the editorial block doubles as a section placeholder.
 */
export const TitleOnly: Story = {
  name: "Title only (compact)",
  args: {
    title: "Pas encore d’activité cette saison",
    kicker: "— TABLEAU DE BORD",
    description: undefined,
    icon: Sparkles,
  },
};
