import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";
import { Badge } from "../badge";

const meta: Meta<typeof Tabs> = {
  title: "Core Components/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "WAI-ARIA tabs pattern. Supports controlled (`value` + `onValueChange`) " +
          "and uncontrolled (`defaultValue`) modes. The `<TabsList>` is " +
          "horizontally scrollable on narrow viewports.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Tabs>;

export const Uncontrolled: Story = {
  name: "Uncontrolled (defaultValue)",
  render: () => (
    <Tabs defaultValue="overview" className="w-[480px]">
      <TabsList>
        <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
        <TabsTrigger value="registrations">Inscriptions</TabsTrigger>
        <TabsTrigger value="settings">Paramètres</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        Statistiques globales de l'événement.
      </TabsContent>
      <TabsContent value="registrations" className="mt-4">
        Liste paginée des participants inscrits.
      </TabsContent>
      <TabsContent value="settings" className="mt-4">
        Configuration de la billetterie et des notifications.
      </TabsContent>
    </Tabs>
  ),
};

export const Controlled: Story = {
  name: "Controlled (value + onValueChange)",
  render: () => {
    const [tab, setTab] = useState("registrations");
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground" role="status">
          Onglet actif : <code>{tab}</code>
        </p>
        <Tabs defaultValue="registrations" value={tab} onValueChange={setTab} className="w-[480px]">
          <TabsList>
            <TabsTrigger value="overview">Vue</TabsTrigger>
            <TabsTrigger value="registrations">Inscriptions</TabsTrigger>
            <TabsTrigger value="settings">Paramètres</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            Contenu vue.
          </TabsContent>
          <TabsContent value="registrations" className="mt-4">
            Contenu inscriptions.
          </TabsContent>
          <TabsContent value="settings" className="mt-4">
            Contenu paramètres.
          </TabsContent>
        </Tabs>
      </div>
    );
  },
};

export const WithBadgeCounts: Story = {
  name: "Triggers with status badges",
  render: () => (
    <Tabs defaultValue="confirmed" className="w-[640px]">
      <TabsList>
        <TabsTrigger value="confirmed">
          Confirmés <Badge className="ml-2" variant="success">42</Badge>
        </TabsTrigger>
        <TabsTrigger value="checked_in">
          Présents <Badge className="ml-2" variant="success">12</Badge>
        </TabsTrigger>
        <TabsTrigger value="cancelled">
          Annulés <Badge className="ml-2" variant="destructive">3</Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="confirmed" className="mt-4">
        42 personnes inscrites sans encore checker.
      </TabsContent>
      <TabsContent value="checked_in" className="mt-4">
        12 personnes ont scanné leur badge à l'entrée.
      </TabsContent>
      <TabsContent value="cancelled" className="mt-4">
        3 inscriptions annulées (avec ou sans remboursement).
      </TabsContent>
    </Tabs>
  ),
};

export const ManyTabsScrollable: Story = {
  name: "Many tabs (overflow scroll)",
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <Tabs defaultValue="overview" className="max-w-full">
      <TabsList className="max-w-full">
        <TabsTrigger value="overview">Vue</TabsTrigger>
        <TabsTrigger value="registrations">Inscriptions</TabsTrigger>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
        <TabsTrigger value="speakers">Intervenants</TabsTrigger>
        <TabsTrigger value="sponsors">Sponsors</TabsTrigger>
        <TabsTrigger value="messaging">Messagerie</TabsTrigger>
        <TabsTrigger value="checkin">Check-in</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
        <TabsTrigger value="settings">Paramètres</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        Faites défiler la barre d'onglets horizontalement sur écran étroit.
      </TabsContent>
    </Tabs>
  ),
};
