import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "../spinner";

const meta: Meta<typeof Spinner> = {
  title: "Core Components/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    "aria-label": "Chargement en cours",
  },
};
export default meta;

type Story = StoryObj<typeof Spinner>;

export const Small: Story = { args: { size: "sm" }, name: "Size: sm" };
export const Medium: Story = { args: { size: "md" }, name: "Size: md (default)" };
export const Large: Story = { args: { size: "lg" }, name: "Size: lg" };

export const AllSizes: Story = {
  name: "All sizes",
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex items-center gap-8">
      <div className="text-center">
        <Spinner size="sm" aria-label="Chargement" />
        <p className="mt-2 font-mono-kicker text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          sm
        </p>
      </div>
      <div className="text-center">
        <Spinner size="md" aria-label="Chargement" />
        <p className="mt-2 font-mono-kicker text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          md
        </p>
      </div>
      <div className="text-center">
        <Spinner size="lg" aria-label="Chargement" />
        <p className="mt-2 font-mono-kicker text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          lg
        </p>
      </div>
    </div>
  ),
};
