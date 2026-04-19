import type { Meta, StoryObj } from "@storybook/react";
import { OrderSummary } from "../order-summary";

const defaultLabels = {
  kicker: "Récapitulatif",
  serviceFees: "Frais de service",
  serviceFeesValue: "Inclus",
  discount: "Code promo appliqué",
  total: "Total",
  free: "Gratuit",
};

const meta: Meta<typeof OrderSummary> = {
  title: "Editorial Primitives/OrderSummary",
  component: OrderSummary,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    coverKey: "evt-dakar-tech-2026",
    eventStartDate: "2026-05-14T09:00:00+00:00",
    eventTitle: "Dakar Tech Summit 2026",
    ticketName: "Pass Standard · 1 billet",
    subtotal: 15000,
    total: 15000,
    currency: "XOF",
    locale: "fr-SN",
    labels: defaultLabels,
    refundNote:
      "Annulation gratuite jusqu’à 48 h avant l’événement. Remboursement sous 5 jours ouvrés.",
  },
  render: (args) => (
    <div style={{ width: 380 }}>
      <OrderSummary {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof OrderSummary>;

export const WithoutDiscount: Story = {};

export const WithDiscount: Story = {
  args: {
    subtotal: 15000,
    discount: 3000,
    total: 12000,
  },
};

export const MultipleTickets: Story = {
  args: {
    ticketName: "Pass VIP · 3 billets",
    subtotal: 75000,
    total: 75000,
  },
};

export const LongEventTitle: Story = {
  args: {
    coverKey: "evt-long-title-wrap",
    eventTitle:
      "Conférence Internationale sur l’Innovation Agricole en Afrique de l’Ouest — Édition 2026",
    ticketName: "Accréditation presse",
    subtotal: 0,
    total: 0,
  },
};
