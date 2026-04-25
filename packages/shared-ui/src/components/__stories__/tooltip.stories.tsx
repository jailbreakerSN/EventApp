import type { Meta, StoryObj } from "@storybook/react";
import { Info } from "lucide-react";
import { Tooltip } from "../tooltip";
import { Button } from "../button";

const meta: Meta<typeof Tooltip> = {
  title: "Core Components/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "CSS-only hover tooltip. Reveals on `:hover` with a 150 ms scale-in. " +
          "Renders `role=\"tooltip\"` on the popup. Use only for short, advisory " +
          "text — for longer or interactive content prefer a `<Popover>` or " +
          "`<Dialog>` (the tooltip is keyboard-inaccessible by design and " +
          "disappears when the mouse leaves).",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Tooltip>;

export const Top: Story = {
  args: {
    content: "Astuce contextuelle au-dessus",
    position: "top",
    children: <Button>Survolez-moi</Button>,
  },
};

export const Bottom: Story = {
  args: {
    content: "Astuce contextuelle en-dessous",
    position: "bottom",
    children: <Button>Survolez-moi</Button>,
  },
};

export const Left: Story = {
  args: {
    content: "À gauche",
    position: "left",
    children: <Button>Survolez-moi</Button>,
  },
};

export const Right: Story = {
  args: {
    content: "À droite",
    position: "right",
    children: <Button>Survolez-moi</Button>,
  },
};

export const OnIcon: Story = {
  name: "On an icon (info badge)",
  args: {
    content: "Cette colonne agrège les check-ins multi-zones.",
    position: "top",
    children: (
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/70"
        aria-label="En savoir plus"
      >
        <Info className="h-3 w-3" />
      </button>
    ),
  },
};

export const FourPositionsShowcase: Story = {
  name: "Showcase: 4 positions",
  parameters: { layout: "padded" },
  render: () => (
    <div className="grid grid-cols-2 gap-12 p-8">
      {(["top", "bottom", "left", "right"] as const).map((pos) => (
        <div key={pos} className="grid place-items-center">
          <Tooltip content={`Position : ${pos}`} position={pos}>
            <Button variant="outline" size="sm">
              {pos}
            </Button>
          </Tooltip>
        </div>
      ))}
    </div>
  ),
};
