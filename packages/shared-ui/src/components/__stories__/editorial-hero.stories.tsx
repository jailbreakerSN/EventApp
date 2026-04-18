import type { Meta, StoryObj } from "@storybook/react";
import { ArrowRight, Settings } from "lucide-react";
import { EditorialHero } from "../editorial-hero";
import { Button } from "../button";

const meta: Meta<typeof EditorialHero> = {
  title: "Editorial Primitives/EditorialHero",
  component: EditorialHero,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;

type Story = StoryObj<typeof EditorialHero>;

/**
 * Default light-background variant. Matches the participant app's
 * `/my-events` dashboard hero — gold mono kicker, Fraunces headline,
 * stats row, and a pair of action buttons aligned to the copy column.
 */
export const DefaultMyEvents: Story = {
  name: "Default · My Events dashboard",
  args: {
    variant: "default",
    kicker: "— BONJOUR AMINATA",
    title: "Votre saison Teranga démarre fort",
    lead: "4 billets actifs, 2 à venir cette semaine. Tout est synchronisé, même hors ligne.",
    stats: [
      { value: "4", label: "Billets actifs" },
      { value: "2", label: "Cette semaine" },
      { value: "12", label: "Événements passés" },
    ],
    actions: (
      <div className="flex gap-2">
        <Button variant="outline" className="rounded-full">
          <Settings className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Paramètres
        </Button>
        <Button className="rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90">
          Découvrir des événements
          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    ),
  },
  render: (args) => (
    <div className="bg-background px-6 pb-10 pt-14 lg:px-8">
      <EditorialHero {...args} />
    </div>
  ),
};

/**
 * Navy full-bleed hero variant used on the homepage. Ships pills,
 * stats and two CTAs. The title uses a decorative composition with a
 * visually-hidden SEO heading alongside the italic italics.
 */
export const NavyHomepage: Story = {
  name: "Navy · Homepage",
  args: {
    variant: "navy",
    kicker: "— TERANGA · VOTRE SAISON D’ÉVÉNEMENTS",
    title: (
      <>
        <span className="sr-only">
          Découvrez les meilleurs événements professionnels et culturels du Sénégal
        </span>
        <span aria-hidden="true">
          Dakar vibre.{" "}
          <em className="italic font-medium text-teranga-gold-light">Inscrivez-vous</em>
          <br />
          et vivez chaque{" "}
          <em className="italic font-medium text-teranga-gold-light">rencontre</em>.
        </span>
      </>
    ),
    lead: "Conférences, ateliers, festivals : chaque semaine, Teranga rassemble la scène professionnelle et culturelle sénégalaise.",
    actions: (
      <>
        <Button className="rounded-full bg-teranga-gold text-teranga-navy hover:bg-teranga-gold-light">
          Explorer les événements
          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10"
        >
          Comment ça marche
        </Button>
      </>
    ),
    stats: [
      { value: "412", label: "Événements" },
      { value: "38k", label: "Inscriptions" },
      { value: "24", label: "Villes" },
      { value: "4.8★", label: "Satisfaction" },
    ],
  },
};

/**
 * Navy event-detail hero — pill row above the title (category + capacity
 * warning) and no stats. Mirrors `/events/[slug]` on the participant app.
 */
export const NavyEventDetail: Story = {
  name: "Navy · Event detail",
  args: {
    variant: "navy",
    pills: (
      <>
        <span className="inline-flex items-center rounded-full bg-teranga-gold px-3 py-1 text-xs font-semibold text-teranga-navy">
          Conférence
        </span>
        <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
          Lieu partenaire
        </span>
        <span className="inline-flex items-center rounded-full bg-teranga-clay px-3 py-1 text-xs font-semibold text-white">
          ⚠ Plus que 12 places
        </span>
      </>
    ),
    title: "Dakar Tech Summit 2026",
    lead: "Trois jours de rencontres, workshops et keynotes pour la prochaine génération de la tech sénégalaise — sur la scène du Grand Théâtre National.",
  },
};

/**
 * Minimal default variant — kicker + title only. Useful for sub-heroes
 * inside long scrollable pages where the stats row would be overkill.
 */
export const DefaultMinimal: Story = {
  name: "Default · Minimal (title only)",
  args: {
    variant: "default",
    kicker: "— PROCHAINEMENT",
    title: "Ramadan Tech Majlis 2026",
    lead: undefined,
    stats: undefined,
    actions: undefined,
  },
  render: (args) => (
    <div className="bg-background px-6 pb-10 pt-14 lg:px-8">
      <EditorialHero {...args} />
    </div>
  ),
};

/**
 * Navy variant without stats or actions. Shows the baseline hero
 * composition — useful for simple landing heroes on the mobile web
 * surface where the stats dl would wrap awkwardly.
 */
export const NavyKickerOnly: Story = {
  name: "Navy · Kicker + title only",
  args: {
    variant: "navy",
    kicker: "— SAINT-LOUIS · MAI 2026",
    title: "Festival international de Jazz",
    lead: "Sept jours, cinq scènes, plus de cinquante artistes réunis sur l’île de Saint-Louis.",
  },
};
