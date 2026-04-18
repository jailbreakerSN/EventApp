import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook config for @teranga/shared-ui.
 *
 * Renders every primitive and core component in isolation with the Teranga
 * Tailwind tokens (navy / gold / green / clay) and editorial typography
 * (Fraunces + Inter + JetBrains Mono) loaded from Google Fonts in
 * preview-head.html.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx|mdx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-themes",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  typescript: {
    // Keep the preview fast — skip docgen in CI; Storybook still resolves
    // `.tsx` sources via the Vite builder and the root tsconfig.
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) =>
        prop.parent ? !/node_modules/.test(prop.parent.fileName) : true,
    },
  },
  docs: {
    autodocs: "tag",
  },
};

export default config;
