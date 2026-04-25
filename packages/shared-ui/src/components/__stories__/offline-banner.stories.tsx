import type { Meta, StoryObj } from "@storybook/react";
import { OfflineBanner } from "../offline-banner";

const meta: Meta<typeof OfflineBanner> = {
  title: "Core Components/OfflineBanner",
  component: OfflineBanner,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Reactively renders a top-of-page banner when `navigator.onLine === false`. " +
          "Wired to `online` / `offline` window events so it disappears automatically " +
          "on reconnect (with a 300 ms fade). The banner is `role=\"alert\"` + " +
          "`aria-live=\"assertive\"` so screen-reader users hear the connectivity " +
          "loss immediately.\n\n" +
          "**Storybook caveat:** the component is event-driven, so it only shows up " +
          "when the browser is genuinely offline. To preview, simulate offline in " +
          "DevTools → Network → Offline.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof OfflineBanner>;

export const Default: Story = {};

export const FrenchLocale: Story = { args: {} };

export const EnglishLocale: Story = {
  args: {
    labels: {
      message: "You're offline. Changes are queued for sync.",
    },
  },
};

export const WolofLocale: Story = {
  args: {
    labels: {
      message: "Yaa ngi ci béri internet — sa toftal ngi tudd jot.",
    },
  },
};

export const Mocked: Story = {
  name: "Showcase: forced visible (mock for layout review)",
  parameters: {
    docs: {
      description: {
        story:
          "Mocked variant that always renders the banner — useful for layout " +
          "review without flipping the OS network state.",
      },
    },
  },
  render: () => (
    <div className="relative">
      <div
        role="alert"
        aria-live="assertive"
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
      >
        <span aria-hidden="true">📡</span>
        <span>Vous êtes hors ligne — les modifications seront synchronisées dès le retour de la connexion.</span>
      </div>
      <div className="pt-12 px-4 text-sm text-muted-foreground">
        Page content placeholder…
      </div>
    </div>
  ),
};
