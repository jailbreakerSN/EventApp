import type { Meta, StoryObj } from "@storybook/react";
import { CalendarX2 } from "lucide-react";
import { EmptyState } from "../empty-state";
import { Button } from "../button";

const meta: Meta<typeof EmptyState> = {
  title: "Core Components/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    icon: CalendarX2,
    title: "Aucun événement pour le moment",
    description:
      "Créez votre premier événement pour commencer à accueillir des participants partout au Sénégal.",
  },
  render: (args) => (
    <div style={{ width: 460 }} className="rounded-card border bg-card">
      <EmptyState {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const WithAction: Story = {
  args: {
    action: <Button>Créer un événement</Button>,
  },
};

export const WithoutAction: Story = {
  args: {
    action: undefined,
  },
};
