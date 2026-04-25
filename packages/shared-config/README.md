# `@teranga/shared-config`

Shared configuration presets used by the Teranga web apps:

- **Tailwind preset** — design tokens (Teranga navy / gold / green palette, typography scale, spacing).
- **ESLint config** — base rules for the monorepo's TypeScript packages.
- **PostCSS / Prettier** _(future)_ — currently the apps inherit defaults; a shared preset will land here when the divergence is large enough to justify it.

> **Canonical reference for the design system:** [`docs/design-system/`](../../docs/design-system/) (legacy location, still authoritative for tokens and accessibility constraints).

## Tailwind preset

The preset is consumed by `apps/web-backoffice` and `apps/web-participant`:

```js
// apps/web-backoffice/tailwind.config.ts
import preset from "@teranga/shared-config/tailwind.preset";

export default {
  presets: [preset],
  content: ["./src/**/*.{ts,tsx}"],
};
```

Brand-locked tokens (must not be overridden):

| Token | Value | Use |
|---|---|---|
| `colors.teranga-navy` | `#0a1f44` | Headers, primary text |
| `colors.teranga-gold` | `#c9a227` | Primary CTAs, accents |
| `colors.teranga-gold-dark` | `#8a6a23` | WCAG 2.1 AA-calibrated companion |
| `colors.teranga-green` | `#2e7d32` | Success, positive state |
| `fontFamily.sans` | `Inter` | All UI text |

WCAG note: `teranga-gold-dark` was recalibrated from `#a78336` to `#8a6a23` to meet 4.5:1 contrast on white in April 2026. Do not regress.

## ESLint config

```js
// apps/<app>/.eslintrc.cjs
module.exports = {
  extends: [require.resolve("@teranga/shared-config/eslint")],
};
```

## What this package is NOT

This package is **not** a component library. UI components live in [`@teranga/shared-ui`](../shared-ui/). This package is configuration only.

## Consumption rule

Every Teranga web app must consume the Tailwind preset and ESLint config from this package — no per-app forks. New brand tokens require a PR to this package and a regeneration of any baked artefacts (e.g., logos, gradients, theme exports).

## Scripts

This package has no build step (it ships preset files directly). Only the import path matters.

| Script | What it does |
|---|---|
| `npm run lint` | ESLint over `src/` (sanity-check the config itself) |
