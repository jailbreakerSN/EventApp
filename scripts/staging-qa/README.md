# Teranga Staging QA — Playwright Suite

Browser-driven QA tests that run against the deployed staging URLs.
Complements the manual QA checklist in `docs/qa/staging-playwright-runbook.md`.

## Quick start

```bash
cd scripts/staging-qa
npm install
npx playwright install --with-deps chromium

# Targets default to the 2026-04-14 staging hosts. Override via env.
STAGING_BACKOFFICE=https://teranga-backoffice-staging-784468934140.europe-west1.run.app \
STAGING_PARTICIPANT=https://teranga-participant-staging-784468934140.europe-west1.run.app \
STAGING_API=https://teranga-api-staging-784468934140.europe-west1.run.app \
  npx playwright test

# Open the HTML report
npx playwright show-report
```

## Suite layout

| Spec | Covers |
| --- | --- |
| `smoke.spec.ts` | Both apps return 200; `<html lang>`; OfflineBanner + Toaster regions; login chrome |
| `i18n.spec.ts` | LanguageSwitcher cookie roundtrip (fr ⇆ en ⇆ wo) — TASK-P1-I1a/b/c/d |
| `theming.spec.ts` | Dark mode flips `html.dark`; `prefers-reduced-motion` honoured globally |
| `discovery.spec.ts` | Date + price chip filters, URL sync, mobile scroll-snap — TASK-P1-H1 |
| `event-detail.spec.ts` | Tablist roles, hash-based tab persistence, arrow-key nav, JSON-LD — TASK-P1-H2 |
| `responsive.spec.ts` | 375 / 768 / 1280 px screenshots of 4 key routes (visual regression input) |
| `a11y.spec.ts` | `axe-core` WCAG 2.1 AA sweep of 6 public routes — fails on serious+ |
| `api-security.spec.ts` | `requireEmailVerified` gate (PR #38) + webhook exemption |

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `STAGING_BACKOFFICE` | `https://teranga-backoffice-staging-…run.app` | Backoffice URL |
| `STAGING_PARTICIPANT` | `https://teranga-participant-staging-…run.app` | Participant URL |
| `STAGING_API` | — | Enables `api-security.spec.ts` |
| `STAGING_UNVERIFIED_ID_TOKEN` | — | Firebase ID token for a user with `email_verified=false` — enables the 403 assertion |
| `CI` | — | Switches reporter to `html + github` and adds one retry |

## CI

`.github/workflows/staging-qa.yml` fires on every successful
`deploy-staging.yml` run and on `workflow_dispatch`. Reports are
uploaded as artefacts (`playwright-report-*`) and retained for 14
days.

## Running a single spec

```bash
npx playwright test tests/smoke.spec.ts
npx playwright test tests/a11y.spec.ts --reporter=list
```

## Debugging

```bash
# Run headed with the Playwright Inspector
PWDEBUG=1 npx playwright test tests/event-detail.spec.ts

# Codegen a new selector against staging
STAGING_BACKOFFICE=... npx playwright codegen $STAGING_BACKOFFICE
```

See `docs/qa/staging-playwright-runbook.md` for the full runbook, including auth-fixture setup for the future authenticated-flow specs.
