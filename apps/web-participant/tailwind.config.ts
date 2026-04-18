import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import preset from "@teranga/shared-config/tailwind";

/**
 * Tailwind config for apps/web-participant.
 *
 * All palette + radius tokens live in the shared preset at
 * packages/shared-config/tailwind.config.ts. Only content globs and
 * app-specific plugins/overrides belong here.
 */
const config: Config = {
  presets: [preset as Config],
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}"],
  plugins: [typography],
};

export default config;
