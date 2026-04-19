import type { Meta, StoryObj } from "@storybook/react";
import { ArrowRight } from "lucide-react";
import { SectionHeader } from "../section-header";

const meta: Meta<typeof SectionHeader> = {
  title: "Editorial Primitives/SectionHeader",
  component: SectionHeader,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    kicker: "— À LA UNE CETTE SAISON",
    title: "Trois événements qu’on ne manquerait pour rien au monde",
    subtitle:
      "Sélectionnés par la rédaction Teranga pour leur ambition, leur impact ou leur singularité.",
  },
};
export default meta;

type Story = StoryObj<typeof SectionHeader>;

export const Section: Story = {};

export const Hero: Story = {
  args: {
    kicker: "— MES ÉVÉNEMENTS",
    title: "Bonjour Aminata, votre saison démarre fort",
    subtitle:
      "4 billets actifs, 2 à venir cette semaine. Tout est synchronisé, même hors ligne.",
    size: "hero",
    as: "h1",
  },
};

export const WithAction: Story = {
  args: {
    kicker: "— AGENDA DE LA SEMAINE",
    title: "12 conférences, ateliers et rencontres à Dakar",
    subtitle: "Filtrez par catégorie ou lieu pour affiner votre sélection.",
    action: (
      <a
        href="#filters"
        className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Filtrer
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    ),
  },
};

export const KickerOnly: Story = {
  args: {
    kicker: "— PROCHAINEMENT",
    title: "Ramadan Tech Majlis",
    subtitle: undefined,
  },
};
