# `@teranga/web-backoffice`

Teranga organizer + admin **Next.js 14** PWA. Used by event organizers to create events, manage registrations, generate badges, run check-in dashboards, and configure their organization. Used by super-admins to operate the platform.

> **Canonical reference:** [`docs-v2/40-clients/web-backoffice.md`](../../docs-v2/40-clients/web-backoffice.md).

## Tech

- **Next.js 14** App Router (RSC + client components).
- **TailwindCSS** + **shadcn/ui** components, branded with Teranga design tokens.
- **`@teranga/shared-ui`** — design-system components shared with the participant app.
- **Firebase Web SDK** for auth (Firebase Authentication) and direct Firestore reads where appropriate.
- **PWA**: manifest, service worker for offline caching of static shells.
- French-first UI (`fr-SN`); English (`en`) and Wolof (`wo`) supported via i18n keys.

## Local dev

```bash
# 1. Set up env (one-time)
cp apps/web-backoffice/.env.example apps/web-backoffice/.env.local

# 2. Build shared-types + shared-ui
npm run types:build
npx turbo build --filter=@teranga/shared-ui

# 3. Start the API (separate terminal)
npm run api:dev

# 4. Start Next.js on :3001
npm run web:dev
```

Default URL: [http://localhost:3001](http://localhost:3001).

## Routing

- `/(auth)/*` — login, signup, password recovery (unauthenticated entry surface).
- `/(dashboard)/*` — authenticated organizer routes (events, registrations, members, organization, billing, ...).
- `/(admin)/*` — super-admin routes; protected by `super_admin` role check.

(Source of truth: `apps/web-backoffice/src/app/`. Route-group naming follows Next.js 14 App Router conventions.)

## Plan gating

Pages that depend on freemium features use `usePlanGating()` and `<PlanGate>` (see [`docs-v2/20-architecture/concepts/freemium-enforcement.md`](../../docs-v2/20-architecture/concepts/freemium-enforcement.md)). Examples:

- Analytics page → `<PlanGate feature="advancedAnalytics" fallback="blur">`
- SMS toggles → `<PlanGate feature="smsNotifications" fallback="disabled">`

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Hot-reload Next.js dev server on port 3001 |
| `npm run build` | Next.js production build |
| `npm run start` | Production server (after build) |
| `npm run lint` | Next.js + ESLint check |
| `npm run type-check` | `tsc --noEmit` |

## Quality gates

- **Lighthouse CI** — performance + a11y budgets. See [`docs-v2/50-operations/ci-cd.md`](../../docs-v2/50-operations/ci-cd.md).
- **WCAG 2.1 AA** — design tokens calibrated; CI checks contrast on key surfaces. See `docs/design-system/accessibility.md`.

## Deployment

Firebase Hosting (alias: `default` for staging, `production` for prod). Build artefacts go through `firebase deploy --only hosting`.
