# Wave 10 / W10-P6 — Web launch prep

**Branch:** `claude/wave-10-production-hardening`
**Status:** shipped (cookie consent + custom-domain runbook); ISR + launch-metrics dashboard deferred with explicit rationale.
**Audits closed:** L4 (cookie consent), L2 partial (custom-domain runbook). The L2 / S1 CSP half landed in W10-P2.

---

## What changed

### 1. Cookie consent banner (L4)

**Where:** `apps/web-participant/src/components/cookie-consent.tsx` + i18n strings in `fr.json` / `en.json` / `wo.json` + mount in `apps/web-participant/src/app/layout.tsx`.

**Posture:** Senegal Loi 2008-12 + GDPR alignment. Sentry observability + (eventually) GA4 analytics are non-essential trackers that REQUIRE explicit consent before loading. The banner is in-house, lightweight (no TCF v2 / IAB) — Senegalese-market-appropriate without IAB framework overhead.

**Persistence model:**

- `localStorage["teranga_cookie_consent_v1"]` ∈ `{ "accepted", "rejected", null }`.
- On click, the choice is persisted AND a `teranga:cookie-consent` `CustomEvent` is dispatched with `detail = "accepted" | "rejected"`. Consumers (Sentry init in particular) subscribe to this event so they can lazily activate without a page reload.

**Sentry gate:** `apps/web-participant/sentry.client.config.ts` now exports a `hasCookieConsent()` helper. The init runs only when (a) `dsn` is set AND (b) consent is already accepted at boot OR (c) the consent event fires post-boot. Users who decline never load the SDK.

**Test:** `apps/web-participant/src/components/__tests__/cookie-consent.test.tsx` — 9 cases covering render gating, both choice paths, persistence, the `CustomEvent` dispatch, and the privacy-link `href`.

**Backoffice:** intentionally NOT mounted on the backoffice. Organisers + super-admins are authenticated employees of paying organisations and analytics tracking falls under the operational legal basis ("legitimate interests" + employer-employee context). The participant app is the public funnel where consent is legally required.

### 2. Custom domain runbook (L2 / second half)

**Where:** `docs/runbooks/custom-domains.md`.

End-to-end procedure for mapping `api.teranga.events`, `app.teranga.events`, `teranga.events` (apex) onto Cloud Run + Firebase Hosting:

- Domain inventory + apex / `www.` redirect strategy.
- `gcloud beta run domain-mappings create` for the API.
- Firebase Hosting console steps for the two web apps.
- Apex-to-www 301 redirect via `firebase.json`.
- Registrar DNS records (A + AAAA + ALIAS + TXT verification).
- `gh variable set` flips for `API_URL_PROD` / `BACKOFFICE_URL_PROD` / `PARTICIPANT_URL_PROD` so the `deploy-production.yml` workflow reads the new URLs without code edits.
- Verification matrix (curl probes for HSTS, CSP report endpoint, apex redirect, SSL).
- HSTS preload submission procedure (after 7 days clean SSL).
- Rollback procedure.

The CSP first half of L2 already landed in W10-P2 § Security hardening.

---

## Deferred — explicit rationale

### ISR / `Cache-Control` for `events/[slug]` (R5 sub-task)

**Why not in this phase:** the existing `force-dynamic` declaration is load-bearing. The inline comment at `apps/web-participant/src/app/(public)/events/[slug]/page.tsx:48-55` documents the constraint:

> The root layout reads the NEXT_LOCALE cookie via next-intl's getLocale() / getMessages(), which means any page under it inherently requires dynamic rendering. Declaring `revalidate` + `generateStaticParams` on top of that put Next.js 15 into ISR mode at runtime and the subsequent cookie read during background revalidation threw DYNAMIC_SERVER_USAGE → 500.

Flipping to `revalidate: 60` would re-introduce that 500. The fix requires migrating the locale source from cookie-based to URL-segment-based (`/[locale]/events/...`), which is a routing refactor outside the Wave 10 scope.

**Tracked as a separate issue.** The participant app today on flaky African networks pays a server-render cost per request — it's not zero, but it's the trade-off until the locale-routing refactor lands.

### Launch-metrics dashboard (L5)

**Why not in this phase:** the four wave-10 KPIs (DAU, active orgs, registrations / day, check-in rate) are computable from the existing `business_event_total` Prometheus counter that W10-P3 emits. The Cloud Monitoring dashboard `dashboards/api-overview.json` already shows registrations / hour and check-ins / hour as leading indicators.

A dedicated `/admin/launch-metrics` page that stacks DAU + ARPU / 30-day-retention is a real product surface that needs design + data-model work; the metric primitives are in place. **Tracked as a separate issue** for the post-launch sprint.

### Web-backoffice + web-participant prod deploy

**Why not in this phase:** `deploy-production.yml` (W10-P5) ships the API + monitoring + backup-schedule provisioning. The web Hosting deploy mirrors the staging YAML's `firebase deploy --only hosting:teranga-app-prod-backoffice / teranga-app-prod-participant` calls and was deferred until the custom-domain runbook landed (so the deploy targets are known). Adding it is mechanical; tracked as a separate issue for the first prod cutover.

---

## Verification log

- `cd apps/web-participant && npx tsc --noEmit` — clean.
- `cd apps/web-participant && npx vitest run` — 3 files / 25 tests green (up from 2 / 16 — the 9 cookie-consent assertions).
- `cd apps/api && npx vitest run` — 136 / 2136 unchanged (no API surface changed in P6).
- Manual: `localStorage.clear(); reload page` shows the banner; click Accept → reload shows nothing; `localStorage["teranga_cookie_consent_v1"]` reads `"accepted"`.

## Mechanical auditor results

- `@l10n-auditor` — to run on this commit (UI surface change in the participant app). The new strings are correctly French-first + EN + WO.
- All other auditors — N/A.

---

## Rollback

| Change                | Rollback                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie consent banner | Remove the `<CookieConsentBanner />` mount from `app/layout.tsx`; delete the component file. The Sentry init falls back to its pre-W10-P6 unconditional posture (active wherever DSN is set). The i18n keys can stay — they're harmless if unreferenced. |
| Custom-domain runbook | Delete the file. Operators revert to the prod deploy workflow's `*.run.app` / `*.web.app` URLs.                                                                                                                                                          |

---

## Wave 10 closing note

W10-P6 closes the production-hardening sweep. Per the W10-P0 plan, every audit finding either:

- shipped (16 of 20),
- explicitly deferred to a follow-up issue with a documented rationale (ISR conversion, launch-metrics dashboard, web-Hosting prod deploy, R4 Firestore index strict gate, cursor pagination for the 6 limit-1000 callers),

and the production deploy workflow is ready for the first manual cutover.
