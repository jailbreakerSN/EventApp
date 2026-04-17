import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "../input";

const meta: Meta<typeof Input> = {
  title: "Core Components/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  render: (args) => (
    <div style={{ width: 320 }}>
      <label
        htmlFor="story-input"
        className="mb-1 block text-sm font-medium text-foreground"
      >
        Nom complet
      </label>
      <Input id="story-input" {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: "Aminata Diallo",
  },
};

export const Disabled: Story = {
  args: {
    placeholder: "Aminata Diallo",
    disabled: true,
    defaultValue: "Aminata Diallo",
  },
};

export const Error: Story = {
  render: (args) => (
    <div style={{ width: 320 }}>
      <label
        htmlFor="story-input-error"
        className="mb-1 block text-sm font-medium text-foreground"
      >
        E-mail
      </label>
      <Input
        id="story-input-error"
        {...args}
        aria-invalid="true"
        defaultValue="aminata@"
        className="border-red-500 focus-visible:ring-red-500/30"
      />
      <p className="mt-1 text-xs text-red-500">
        Adresse e-mail invalide. Exemple : aminata@example.sn
      </p>
    </div>
  ),
};
