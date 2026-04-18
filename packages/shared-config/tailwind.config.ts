import type { Config } from "tailwindcss";

/**
 * Teranga shared Tailwind preset.
 *
 * Single source of truth for the Teranga design tokens (palette, radii, and
 * shadcn HSL bindings). Every web-facing Tailwind config (apps/web-backoffice,
 * apps/web-participant, packages/shared-ui) imports this preset so tokens stay
 * in lock-step and no drift is possible.
 *
 * Import as a preset in each web app's tailwind.config.ts:
 *
 *   import preset from "@teranga/shared-config/tailwind";
 *   // then pass it via `presets: [preset]`
 *
 * or, from a CJS config, `presets: [require("@teranga/shared-config/tailwind")]`.
 *
 * Note: App-level globals.css files remain responsible for declaring the
 * shadcn CSS variables (`--background`, `--primary`, etc.) per-theme. This
 * preset only binds Tailwind utilities to those variables — it never defines
 * values for the `--*` vars themselves.
 */
const preset: Partial<Config> = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        teranga: {
          // ── Core brand palette ────────────────────────────────────────────
          navy: "#1A1A2E",
          "navy-2": "#16213E", // mid-navy, hero gradient stop
          "navy-3": "#0F0F1C", // deepest navy, rare use
          gold: "#c59e4b", // aligned with logo muted gold
          "gold-light": "#d1b372", // light sand accent
          "gold-dark": "#a78336", // darker gold for text on white (WCAG AA)
          "gold-soft": "#f0e6ce", // pale gold, surfaces & chips
          "gold-whisper": "#faf6ee", // cream, ticket paper
          green: "#0F9B58", // success/confirmed states
          forest: "#2a473c", // deep teal green from logo
          "forest-dark": "#172721", // near-black, dark backgrounds
          clay: "#c86f4b", // urgency / warning / accent
        },
        // ── shadcn HSL bindings (values live in app globals.css) ────────────
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
        // ── Editorial radii ──────────────────────────────────────────────────
        // Larger, softer corners matching the Teranga participant prototype.
        // Use "card" for event cards, "tile" for featured tiles and sticky
        // panels, "pass" for ticket-pass style surfaces.
        card: "14px",
        tile: "20px",
        pass: "22px",
      },
    },
  },
};

export default preset;
