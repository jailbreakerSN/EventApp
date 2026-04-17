import type { Meta, StoryObj } from "@storybook/react";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { Button } from "../button";

const meta: Meta<typeof Button> = {
  title: "Core Components/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    children: "Voir tous les événements",
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: "default" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Partager" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Annuler mon inscription" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Plus tard" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "Détails" },
};

export const Loading: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Traitement en cours…
      </>
    ),
  },
};

export const IconOnly: Story = {
  args: {
    size: "icon",
    variant: "outline",
    "aria-label": "Télécharger le billet",
    children: <Download className="h-4 w-4" aria-hidden="true" />,
  },
};

export const WithTrailingIcon: Story = {
  args: {
    children: (
      <>
        S’inscrire
        <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
      </>
    ),
  },
};
