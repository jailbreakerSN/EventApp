# @teranga/shared-ui

Shared React UI components used by `apps/web-participant` and
`apps/web-backoffice`. Built with React 18/19, Tailwind CSS 3, and the
Teranga design tokens (navy / gold / green / clay + Fraunces / Inter /
JetBrains Mono).

The authoritative prop contracts and editorial rules live in
[`docs/design-system/component-patterns.md`](../../docs/design-system/component-patterns.md).
Storybook mirrors those contracts with live examples.

---

## Running Storybook

From the repo root:

```bash
npm run storybook --workspace=@teranga/shared-ui
```

Or from the package directory:

```bash
cd packages/shared-ui
npm run storybook
```

This boots the Storybook dev server on <http://localhost:6006>. Hot reload
is wired through the Vite builder, so any change under `src/**` refreshes
the preview in place.

### Other scripts

| Script                     | Description                                                     |
| -------------------------- | --------------------------------------------------------------- |
| `npm run storybook`        | Start the dev server on :6006                                   |
| `npm run build-storybook`  | Produce a static build in `storybook-static/` (git-ignored)     |
| `npm run storybook:test`   | Run `@storybook/test-runner` (a11y + smoke check on every story) |

The static build is used for CI preview deploys; run locally to verify
that stories compile and no axe violations are introduced:

```bash
npm run build-storybook --workspace=@teranga/shared-ui
```

---

## Authoring a new story

1. Create (or reuse) a component in `src/components/<name>.tsx`.
2. Add a story file next to it under
   `src/components/__stories__/<name>.stories.tsx`.
3. Follow this template:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { MyComponent } from "../my-component";

const meta: Meta<typeof MyComponent> = {
  title: "Editorial Primitives/MyComponent", // or "Core Components/..."
  component: MyComponent,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: {
    // French-first copy — this is a francophone product.
    label: "Voir le billet",
  },
};
export default meta;

type Story = StoryObj<typeof MyComponent>;

export const Default: Story = {};
```

### Conventions

- **French copy** — participant-facing strings must be in French.
  Examples can use realistic event names ("Dakar Tech Summit 2026",
  "Ramadan Tech Majlis"), real local payment providers (Wave / Orange
  Money / Free Money), and XOF amounts.
- **Cover a few states** — each component should have at least a
  default story plus variants for interactive/edge cases
  (`disabled`, `error`, `loading`, `selected`, etc.).
- **Dark mode works for free** — the theme toggle lives in the
  Storybook toolbar (provided by `@storybook/addon-themes`) and adds
  the `.dark` class on `<html>`. If a story renders poorly on dark,
  that’s a design bug — fix it at the component level, not with
  per-story overrides.
- **Interaction testing** — when a component has meaningful behaviour
  (radio selection, form validation, modal open/close), add a `play`
  function using `@storybook/test` (`userEvent`, `within`, `expect`).
  The test-runner replays `play` on every story in CI.
- **Accessibility** — the a11y addon runs axe-core on every story.
  Don’t disable violations unless you have a concrete design rationale
  documented in the story file.

### Viewports

Four breakpoints are preconfigured in `.storybook/preview.ts`:

| Name    | Width  | Typical use                      |
| ------- | ------ | -------------------------------- |
| mobile  | 375px  | iPhone SE, minimum supported     |
| tablet  | 768px  | iPad portrait, organizer devices |
| desktop | 1280px | Standard laptop                  |
| wide    | 1536px | External monitor                 |

Switch viewports from the toolbar to verify responsive behaviour. Stories
that depend on a specific viewport can set
`parameters.viewport.defaultViewport = "mobile"`.

---

## Configuration reference

- `.storybook/main.ts` — stories glob + addon registration + Vite
  framework.
- `.storybook/preview.ts` — global decorators (theme class + layout
  wrapper), viewport presets, a11y config, story sort order.
- `.storybook/preview.css` — Tailwind entrypoint with Teranga design
  tokens. Kept in sync with
  `apps/web-participant/src/app/globals.css`.
- `.storybook/preview-head.html` — Google Fonts preconnect + link for
  Fraunces, Inter, JetBrains Mono.
- `tailwind.config.ts` — package-local Tailwind config. Mirrors
  `apps/web-participant/tailwind.config.ts`.
- `postcss.config.cjs` — PostCSS pipeline consumed by the Vite
  preview builder.

---

## Out of scope

- Visual regression (Chromatic or Percy) — not wired up. If you need
  snapshot baselines, run `build-storybook` locally and commit a
  proposal in a separate PR.
- Mobile Flutter widgets — the Storybook here covers React only.
  Flutter widgetbook stories live under `apps/mobile/`.
