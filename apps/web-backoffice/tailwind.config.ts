import type { Config } from "tailwindcss";
import preset from "@teranga/shared-config/tailwind";

/**
 * Tailwind config for apps/web-backoffice.
 *
 * All palette + radius tokens live in the shared preset at
 * packages/shared-config/tailwind.config.ts. Only content globs and
 * app-specific plugins/overrides belong here.
 */
const config: Config = {
  presets: [preset as Config],
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "scan-line": {
          "0%": { transform: "translateY(0%)" },
          "50%": { transform: "translateY(208px)" },
          "100%": { transform: "translateY(0%)" },
        },
      },
      animation: {
        "scan-line": "scan-line 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
