import type { Meta, StoryObj } from "@storybook/react";
import { LogoLoader } from "../logo-loader";

const meta: Meta<typeof LogoLoader> = {
  title: "Core Components/LogoLoader",
  component: LogoLoader,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Branded full-page loader using the Teranga logo. Use during initial " +
          "auth bootstrap, route transitions on the dashboard shell, and any " +
          "context where a generic spinner would feel cold for a > 500 ms wait.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof LogoLoader>;

// Inline data-URI 1×1 placeholder so stories don't depend on the
// consumer app's public/ folder.
const PLACEHOLDER_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 56'><circle cx='28' cy='28' r='20' fill='%23c9a227'/></svg>",
  );

export const Default: Story = {
  args: { src: PLACEHOLDER_SRC, alt: "Chargement" },
};

export const WithLabel: Story = {
  args: {
    src: PLACEHOLDER_SRC,
    alt: "Chargement",
    label: "Préparation de votre tableau de bord…",
  },
};

export const SmallSize: Story = {
  args: { src: PLACEHOLDER_SRC, alt: "Chargement", size: 32 },
};

export const LargeSize: Story = {
  args: { src: PLACEHOLDER_SRC, alt: "Chargement", size: 96 },
};

export const InContext: Story = {
  name: "Showcase: card-shaped placeholder area",
  parameters: { layout: "fullscreen" },
  render: () => (
    <div className="grid h-[480px] place-items-center bg-background">
      <LogoLoader src={PLACEHOLDER_SRC} alt="Chargement" label="Connexion en cours…" />
    </div>
  ),
};

