import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../card";
import { Button } from "../button";

const meta: Meta<typeof Card> = {
  title: "Core Components/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Basic: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">
          Carte simple avec uniquement du contenu. Utile pour un résumé
          statique.
        </p>
      </CardContent>
    </Card>
  ),
};

export const WithHeader: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Conférence Tech Dakar 2026</CardTitle>
        <CardDescription>
          Trois jours pour repenser l’innovation en Afrique de l’Ouest.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          14 → 16 mai 2026 · Dakar · 847 inscrits
        </p>
      </CardContent>
    </Card>
  ),
};

export const WithHeaderAndFooter: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Billet confirmé</CardTitle>
        <CardDescription>Votre inscription a été enregistrée.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Un e-mail vient d’être envoyé à aminata.diallo@example.sn.
        </p>
      </CardContent>
      <CardFooter className="gap-3">
        <Button variant="outline">Télécharger</Button>
        <Button>Voir mon billet</Button>
      </CardFooter>
    </Card>
  ),
};
