import type { Config } from "tailwindcss";

/**
 * Tailwind config scoped to Storybook (and future package-local tooling).
 *
 * Mirrors apps/web-participant/tailwind.config.ts so Storybook renders
 * components with the same tokens as production. Keep in sync when the
 * participant app evolves the palette.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./.storybook/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        teranga: {
          navy: "#1A1A2E",
          "navy-2": "#16213E",
          "navy-3": "#0F0F1C",
          gold: "#c59e4b",
          "gold-light": "#d1b372",
          "gold-dark": "#a78336",
          "gold-soft": "#f0e6ce",
          "gold-whisper": "#faf6ee",
          green: "#0F9B58",
          forest: "#2a473c",
          "forest-dark": "#172721",
          clay: "#c86f4b",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "14px",
        tile: "20px",
        pass: "22px",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
