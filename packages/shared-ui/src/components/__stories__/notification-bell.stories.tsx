import type { Meta, StoryObj } from "@storybook/react";
import { NotificationBell, type NotificationBellRow } from "../notification-bell";

// Stable fixed ISO timestamps keep the visual regression snapshot
// deterministic — if we used `Date.now() - N * MIN`, every CI run would
// produce a different "il y a N min" label and churn the snapshot.
const NOW = "2026-04-22T10:00:00.000Z";
const MIN_AGO = "2026-04-22T09:58:00.000Z";
const HOUR_AGO = "2026-04-22T09:00:00.000Z";
const YESTERDAY = "2026-04-21T10:00:00.000Z";

function formatRelative(iso: string): string {
  const map: Record<string, string> = {
    [NOW]: "à l’instant",
    [MIN_AGO]: "il y a 2 min",
    [HOUR_AGO]: "il y a 1 h",
    [YESTERDAY]: "hier",
  };
  return map[iso] ?? iso;
}

const sampleRows: NotificationBellRow[] = [
  {
    id: "n1",
    title: "Votre badge est prêt",
    body: "Vous pouvez télécharger le PDF de votre badge pour le Dakar Tech Summit.",
    createdAt: MIN_AGO,
    isRead: false,
    href: "/badges/bg-001",
  },
  {
    id: "n2",
    title: "Rappel : Dakar Tech Summit demain",
    body: "Rendez-vous demain à 10h00 au CICAD, Diamniadio. Pensez à télécharger votre badge.",
    createdAt: HOUR_AGO,
    isRead: false,
    href: "/events/event-001",
  },
  {
    id: "n3",
    title: "Inscription confirmée — Dakar Tech Summit",
    body: "Votre inscription au Billet Standard est confirmée.",
    createdAt: YESTERDAY,
    isRead: true,
    href: "/registrations/reg-001",
  },
];

const meta: Meta<typeof NotificationBell> = {
  title: "Core Components/NotificationBell",
  component: NotificationBell,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    notifications: sampleRows,
    unreadCount: 2,
    seeAllHref: "/notifications",
    formatRelative,
  },
};

export default meta;

type Story = StoryObj<typeof NotificationBell>;

export const Default: Story = {};

export const WithUnreadBadge: Story = {
  args: {
    unreadCount: 12,
  },
};

export const OverflowBadge: Story = {
  args: {
    unreadCount: 142,
  },
};

export const Empty: Story = {
  args: {
    notifications: [],
    unreadCount: 0,
  },
};

export const Loading: Story = {
  args: {
    notifications: [],
    unreadCount: 0,
    isLoading: true,
  },
};

export const ErrorState: Story = {
  args: {
    notifications: [],
    unreadCount: 0,
    errorMessage: "Impossible de charger les notifications. Réessayez dans un instant.",
  },
};

export const AllRead: Story = {
  args: {
    unreadCount: 0,
    notifications: sampleRows.map((r) => ({ ...r, isRead: true })),
  },
};
