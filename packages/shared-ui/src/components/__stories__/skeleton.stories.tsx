import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "../skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Core Components/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Loading placeholder with the canonical shimmer animation. Compose " +
          "multiple skeletons to mirror the eventual layout — better than a " +
          "spinner because (a) it tells users *what* is loading, not just *that* " +
          "something is, (b) it prevents layout shift, (c) it's perceived as " +
          "faster (Nielsen Norman Group, 2022).",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Skeleton>;

export const Line: Story = {
  render: () => <Skeleton className="h-4 w-48" />,
};

export const Circle: Story = {
  render: () => <Skeleton className="h-12 w-12 rounded-full" />,
};

export const Card: Story = {
  name: "Card-shaped (3 lines + footer)",
  render: () => (
    <div className="space-y-2 rounded-card border border-border bg-card p-4">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  ),
};

export const ListRows: Story = {
  name: "List rows (5 entries)",
  render: () => (
    <ul className="flex flex-col gap-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20" />
        </li>
      ))}
    </ul>
  ),
};

export const TableRows: Story = {
  name: "Table rows (mirrors DataTable loading)",
  render: () => (
    <div className="rounded-card border border-border bg-card">
      <div className="grid grid-cols-4 gap-4 border-b border-border px-4 py-3 text-xs uppercase tracking-[0.12em] text-muted-foreground">
        <span>Nom</span>
        <span>Email</span>
        <span>Statut</span>
        <span className="text-right">Inscrit le</span>
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-4 gap-4 border-b border-border px-4 py-3 last:border-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  ),
};

export const EventDetailHero: Story = {
  name: "Showcase: event detail hero placeholder",
  render: () => (
    <div className="space-y-4">
      <Skeleton className="h-48 w-full rounded-card" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>
    </div>
  ),
};
