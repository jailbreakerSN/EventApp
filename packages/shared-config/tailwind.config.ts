import type { Config } from "tailwindcss";

/**
 * Teranga shared Tailwind preset.
 * Import as a preset in each web app's tailwind.config.ts:
 *   presets: [require("@teranga/shared-config/tailwind")]
 */
const preset: Partial<Config> = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        teranga: {
          navy: "#1A1A2E",
          gold: "#c59e4b",            // aligned with logo muted gold
          "gold-light": "#d1b372",    // light sand accent
          "gold-dark": "#a78336",     // darker gold for text on white (WCAG AA)
          green: "#0F9B58",
          forest: "#2a473c",          // deep teal green from logo
          "forest-dark": "#172721",   // near-black, dark backgrounds
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
};

export default preset;
