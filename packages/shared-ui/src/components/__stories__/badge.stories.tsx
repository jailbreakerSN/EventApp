import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../badge";

const meta: Meta<typeof Badge> = {
  title: "Core Components/Badge",
  component: Badge,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    children: "Confirmé",
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { variant: "default" } };
export const Secondary: Story = {
  args: { variant: "secondary", children: "Brouillon" },
};
export const Destructive: Story = {
  args: { variant: "destructive", children: "Annulé" },
};
export const Outline: Story = {
  args: { variant: "outline", children: "Archivé" },
};
export const Success: Story = {
  args: { variant: "success", children: "Paiement reçu" },
};
export const Warning: Story = {
  args: { variant: "warning", children: "En attente" },
};
export const Info: Story = {
  args: { variant: "info", children: "Liste d’attente" },
};
export const Pending: Story = {
  args: { variant: "pending", children: "Paiement en attente" },
};
export const Neutral: Story = {
  args: { variant: "neutral", children: "Remboursé" },
};
export const Premium: Story = {
  args: { variant: "premium", children: "Pass VIP" },
};

export const AllVariants: Story = {
  name: "All variants (catalog)",
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex max-w-[560px] flex-wrap gap-2">
      <Badge variant="default">Confirmé</Badge>
      <Badge variant="secondary">Brouillon</Badge>
      <Badge variant="destructive">Annulé</Badge>
      <Badge variant="outline">Archivé</Badge>
      <Badge variant="success">Paiement reçu</Badge>
      <Badge variant="warning">En attente</Badge>
      <Badge variant="info">Liste d’attente</Badge>
      <Badge variant="pending">Paiement en attente</Badge>
      <Badge variant="neutral">Remboursé</Badge>
      <Badge variant="premium">Pass VIP</Badge>
    </div>
  ),
};
