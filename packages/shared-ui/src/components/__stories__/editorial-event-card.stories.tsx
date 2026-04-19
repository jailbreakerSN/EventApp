import type { Meta, StoryObj } from "@storybook/react";
import { EditorialEventCard } from "../editorial-event-card";

const meta: Meta<typeof EditorialEventCard> = {
  title: "Editorial Primitives/EditorialEventCard",
  component: EditorialEventCard,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    href: "/events/dakar-tech-summit-2026",
    coverKey: "evt-dakar-tech-2026",
    categoryLabel: "Conférence",
    index: 1,
    total: 8,
    dateLabel: "14 mai 2026",
    cityLabel: "Dakar",
    title: "Dakar Tech Summit — la scène tech sénégalaise rassemblée",
    description:
      "Trois jours de keynotes, ateliers et rencontres entre fondateurs, investisseurs et institutions.",
    priceLabel: "12 500 XOF",
    registeredLabel: "312 inscrits · 78 % rempli",
    ariaLabel: "Dakar Tech Summit — 14 mai 2026, Dakar — 12 500 XOF",
  },
  render: (args) => (
    <div style={{ width: 360 }}>
      <EditorialEventCard {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof EditorialEventCard>;

/** Paid event with a registered stat line — baseline editorial card. */
export const PaidWithStats: Story = {
  name: "Paid · with registered stat",
};

/** Free event variant — priceLabel set to the pre-localized free label. */
export const FreeEvent: Story = {
  name: "Free event",
  args: {
    priceLabel: "Gratuit",
    registeredLabel: "86 inscrits",
    title: "Ramadan Tech Majlis — rencontres hebdomadaires",
    description: "Sessions informelles chaque vendredi soir pendant le mois du Ramadan.",
  },
};

/**
 * Near-capacity event — the primitive renders the urgency pill in place
 * of the category kicker.
 */
export const UrgencyPill: Story = {
  name: "Urgency pill (almost full)",
  args: {
    urgencyLabel: "Plus que 8 places",
    registeredLabel: "192 inscrits · 96 % rempli",
    title: "Saint-Louis Jazz Festival — Open Air",
    coverKey: "evt-saint-louis-jazz",
    cityLabel: "Saint-Louis",
    dateLabel: "12 juin 2026",
    priceLabel: "8 000 XOF",
  },
};

/**
 * Card without description or registered line. Covers the early-state
 * case where the event was just published and has no attendees yet.
 */
export const MinimalEarlyPublish: Story = {
  name: "Minimal (no description, no registered)",
  args: {
    description: null,
    registeredLabel: null,
    title: "Thiès Ag-Tech Forum",
    coverKey: "evt-thies-ag-tech",
    cityLabel: "Thiès",
    dateLabel: "3 juillet 2026",
    priceLabel: "Sur invitation",
  },
};

/**
 * The 8 cover keys demonstrate the deterministic palette rotation —
 * the primitive hashes `coverKey` to pick a gradient so the same key
 * always produces the same cover across pages and reloads.
 */
export const GradientRotation: Story = {
  name: "8 coverKeys (gradient rotation)",
  parameters: { layout: "padded" },
  render: () => {
    const keys = [
      { k: "evt-dakar-tech-2026", title: "Dakar Tech Summit", city: "Dakar" },
      { k: "evt-ramadan-majlis", title: "Ramadan Tech Majlis", city: "Dakar" },
      { k: "evt-saint-louis-jazz", title: "Saint-Louis Jazz Festival", city: "Saint-Louis" },
      { k: "evt-thies-ag-tech", title: "Thiès Ag-Tech Forum", city: "Thiès" },
      { k: "evt-ziguinchor-culture", title: "Ziguinchor Culture Week", city: "Ziguinchor" },
      { k: "evt-kaolack-startup", title: "Kaolack Startup Nights", city: "Kaolack" },
      { k: "evt-mbour-surf", title: "Mbour Surf & Ocean", city: "Mbour" },
      { k: "evt-touba-sciences", title: "Touba Sciences Humaines", city: "Touba" },
    ];
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {keys.map((e, i) => (
          <EditorialEventCard
            key={e.k}
            href={`/events/${e.k}`}
            coverKey={e.k}
            categoryLabel="Conférence"
            dateLabel={`${14 + i} juin 2026`}
            cityLabel={e.city}
            title={e.title}
            description="Aperçu éditorial — remplacez la copie par le résumé de l’événement."
            priceLabel={i % 3 === 0 ? "Gratuit" : `${5000 + i * 1500} XOF`}
            registeredLabel={`${40 + i * 12} inscrits`}
            index={i + 1}
            total={keys.length}
            ariaLabel={`${e.title} — ${e.city}`}
          />
        ))}
      </div>
    );
  },
};
