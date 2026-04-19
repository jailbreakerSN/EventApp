import type { Preview } from "@storybook/react";
import { withThemeByClassName } from "@storybook/addon-themes";

// Imports the Tailwind-compiled preview stylesheet (tokens, @layer base,
// teranga-cover utility classes, dark overrides). Processed by PostCSS
// through the Vite builder.
import "./preview.css";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      // The theme decorator handles background; keep the addon control so
      // stories can still opt-in to explicit greys for layout debugging.
      default: "light",
      values: [
        { name: "light", value: "#faf6ee" },
        { name: "dark", value: "#0e1a14" },
        { name: "white", value: "#ffffff" },
      ],
    },
    viewport: {
      viewports: {
        mobile: {
          name: "Mobile (iPhone SE, 375px)",
          styles: { width: "375px", height: "667px" },
          type: "mobile",
        },
        tablet: {
          name: "Tablet (768px)",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        desktop: {
          name: "Desktop (1280px)",
          styles: { width: "1280px", height: "800px" },
          type: "desktop",
        },
        wide: {
          name: "Wide (1536px)",
          styles: { width: "1536px", height: "900px" },
          type: "desktop",
        },
      },
    },
    a11y: {
      // axe-core runs on every story by default — flag any violation.
      config: {
        rules: [
          // `color-contrast` is checked by default; editorial primitives on
          // gradient covers are exempt because parent composition provides
          // contrast — disable per-story via `parameters.a11y.disable`.
        ],
      },
    },
    options: {
      storySort: {
        order: [
          "Introduction",
          "Editorial Primitives",
          [
            "SectionHeader",
            "Stepper",
            "OrderSummary",
            "TicketPass",
            "PaymentMethodCard",
            "CapacityBar",
            "StatusPill",
          ],
          "Core Components",
        ],
      },
    },
  },
  decorators: [
    withThemeByClassName({
      themes: {
        Light: "",
        Dark: "dark",
      },
      defaultTheme: "Light",
      parentSelector: "html",
    }),
    (Story) => {
      return Story();
    },
  ],
};

export default preview;
