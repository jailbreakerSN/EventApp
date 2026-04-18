import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import preset from "@teranga/shared-config/tailwind";

/**
 * Tailwind config scoped to Storybook (and future package-local tooling).
 *
 * All palette + radius tokens live in the shared preset at
 * packages/shared-config/tailwind.config.ts so stories render with the
 * same tokens as the production apps. Only content globs and
 * package-specific plugins belong here.
 */
const config: Config = {
  presets: [preset as Config],
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "./.storybook/**/*.{js,ts,jsx,tsx,mdx}"],
  plugins: [typography],
};

export default config;
