import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        teranga: {
          navy: "#1A1A2E",
          "navy-2": "#16213E",        // mid-navy, hero gradient stop
          "navy-3": "#0F0F1C",        // deepest navy, rare use
          gold: "#c59e4b",            // aligned with logo muted gold
          "gold-light": "#d1b372",    // light sand accent
          "gold-dark": "#a78336",     // darker gold for text on white (WCAG AA)
          "gold-soft": "#f0e6ce",     // pale gold, surfaces & chips
          "gold-whisper": "#faf6ee",  // cream, ticket paper
          green: "#0F9B58",           // for success/confirmed states
          forest: "#2a473c",          // deep teal green from logo
          "forest-dark": "#172721",   // near-black, dark backgrounds
          clay: "#c86f4b",            // urgency / warning / accent
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
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
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
        // Editorial radii — larger, softer corners matching the Teranga
        // participant prototype. Use "card" for event cards, "tile" for
        // featured tiles and sticky panels.
        card: "14px",
        tile: "20px",
        pass: "22px",
      },
    },
  },
  plugins: [],
};

export default config;
