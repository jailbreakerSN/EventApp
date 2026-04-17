import type { Meta, StoryObj } from "@storybook/react";
import { CapacityBar } from "../capacity-bar";

const meta: Meta<typeof CapacityBar> = {
  title: "Editorial Primitives/CapacityBar",
  component: CapacityBar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    capacity: 500,
    percentLabel: "50% rempli",
    seatsLabel: "250 places restantes",
  },
  render: (args) => (
    <div style={{ width: 360 }}>
      <CapacityBar {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof CapacityBar>;

export const Empty: Story = {
  name: "0% rempli",
  args: {
    registered: 0,
    capacity: 500,
    percentLabel: "0% rempli",
    seatsLabel: "500 places restantes",
  },
};

export const Half: Story = {
  name: "50% rempli",
  args: {
    registered: 250,
    capacity: 500,
    percentLabel: "50% rempli",
    seatsLabel: "250 places restantes",
  },
};

export const NearFull: Story = {
  name: "80% rempli",
  args: {
    registered: 400,
    capacity: 500,
    percentLabel: "80% rempli",
    seatsLabel: "Plus que 100 places",
  },
};

export const Full: Story = {
  name: "100% rempli",
  args: {
    registered: 500,
    capacity: 500,
    percentLabel: "Complet",
    seatsLabel: "Liste d’attente ouverte",
  },
};

export const WithPulseDot: Story = {
  name: "With pulse dot (live)",
  args: {
    registered: 423,
    capacity: 500,
    percentLabel: "85% rempli",
    seatsLabel: "Plus que 77 places",
    pulseDot: true,
  },
};
