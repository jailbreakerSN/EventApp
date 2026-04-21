# Teranga — Documentation v2

> **Canonical reference as of April 2026.** Legacy sprint artefacts and design-system audits live in [`docs/`](../docs/ARCHIVE.md). If a legacy file contradicts this documentation, this documentation is correct.

---

## What is Teranga?

**Teranga** is a multi-tenant SaaS event-management platform built for the Senegalese and francophone West-African market. The name is the Wolof word for *hospitality*. The platform lets event organizers create, publish, and manage events end-to-end — from ticket sales and registration to QR-code check-in and post-event analytics — with a hard requirement on **offline-first check-in** for venues with intermittent connectivity.

Three client surfaces serve different audiences:

| Surface | Audience | Tech |
|---|---|---|
| **Web back-office** | Organizers, admins, super-admins | Next.js 15 PWA |
| **Web participant app** | Participants (public + authenticated) | Next.js 15 SSR/SSG |
| **Mobile app** | Participants, staff scanners | Flutter 3 (iOS + Android) |

All three are backed by a single **Fastify REST API** on Cloud Run and a **Firebase** platform (Firestore, Auth, Functions v2, Storage, FCM).

---

## Status Tags

Every document in `docs-v2/` carries a frontmatter status tag:

| Tag | Meaning |
|---|---|
| `status: shipped` | Feature is implemented and deployed to staging |
| `status: partial` | Route/service exists; some paths are stubs or unfinished |
| `status: stub` | Schema/type defined; no implementation yet |
| `status: planned` | In the roadmap but no code exists |

When you read a section marked **⚠ partial** or **🔲 stub**, the feature exists in the codebase but is not fully functional. Do not rely on it for production use.

---

## Documentation Map

### [00 · Getting Started](./00-getting-started/) — Tutorials
Step-by-step walkthroughs for engineers joining the project.

- [01 · Local setup](./00-getting-started/01-local-setup.md) — Clone, install, configure, run all services locally
- [02 · Create your first event](./00-getting-started/02-first-event-walkthrough.md) — End-to-end walkthrough via the back-office
- [03 · Run your first check-in](./00-getting-started/03-first-checkin.md) — QR generation → scan → offline sync flow
- [04 · Deploy to staging](./00-getting-started/04-deploy-to-staging.md) — CI pipeline, Cloud Run, Firebase deploy

### [10 · Product](./10-product/) — Explanation
What the platform does, who it serves, and where it is going.

- [Overview](./10-product/overview.md) — Mission, market, core differentiators
- [Personas](./10-product/personas.md) — The 8 user roles and their journeys
- [Feature matrix](./10-product/features-matrix.md) — Persona × feature × implementation status
- [Freemium model](./10-product/freemium-model.md) — Plan tiers, limits, feature flags
- [Roadmap](./10-product/roadmap.md) — 10-wave delivery plan, current state, upcoming waves
- [Glossary](./10-product/glossary.md) — Domain terms (Kid, NotBefore, EffectiveLimits, ScanPolicy…)

### [20 · Architecture](./20-architecture/) — Reference + Explanation
How the system is built and why key decisions were made.

- [System overview](./20-architecture/overview.md) — C4 Level 1 + Level 2 diagrams (text-based)
- **Concepts** (long-form explanations of the system's most important ideas)
  - [Multi-tenancy & org isolation](./20-architecture/concepts/multi-tenancy.md)
  - [QR v4 signing & offline-sync encryption](./20-architecture/concepts/qr-v4-and-offline-sync.md)
  - [Freemium enforcement (effectiveLimits)](./20-architecture/concepts/freemium-enforcement.md)
  - [Domain events & audit trail](./20-architecture/concepts/domain-events.md)
- **Reference** (look-up tables)
  - [Data model](./20-architecture/reference/data-model.md) — All Firestore collections + field schemas
  - [Permissions](./20-architecture/reference/permissions.md) — 30+ `resource:action` strings per role
  - [Audit actions](./20-architecture/reference/audit-actions.md) — All 83 `AuditAction` enum values
- **Architecture Decision Records**
  - [ADR index](./20-architecture/decisions/README.md)

### [30 · API](./30-api/) — Reference
Complete HTTP API reference for `/v1/…` endpoints.

- [API conventions](./30-api/README.md) — Auth, pagination, rate limiting, error shapes
- [Events](./30-api/events.md) · [Registrations](./30-api/registrations.md) · [Check-ins](./30-api/checkins.md)
- [Badges](./30-api/badges.md) · [Organizations](./30-api/organizations.md) · [Subscriptions](./30-api/subscriptions.md)
- [Payments](./30-api/payments.md) · [Notifications](./30-api/notifications.md) · [Feed](./30-api/feed.md)
- [Messaging](./30-api/messaging.md) · [Venues](./30-api/venues.md) · [Admin](./30-api/admin.md)

### [40 · Clients](./40-clients/) — Reference
Per-surface feature inventories and development notes.

- [Shared packages](./40-clients/shared/) — [`@teranga/shared-types`](./40-clients/shared/shared-types.md), [`@teranga/shared-ui`](./40-clients/shared/shared-ui.md)
- [Web back-office](./40-clients/web-backoffice.md) — Organizer/admin PWA
- [Web participant app](./40-clients/web-participant.md) — Public + authenticated participant surface
- [Mobile app](./40-clients/mobile-flutter.md) — Flutter iOS/Android

### [50 · Operations](./50-operations/) — How-to
Running, deploying, and operating the platform.

- [Local development](./50-operations/local-development.md) — Day-to-day dev loop
- [Firebase emulators](./50-operations/firebase-emulators.md) — Emulator setup, ports, gotchas
- [Seeding](./50-operations/seeding.md) — Seed scripts, test data personas, idempotency
- [CI / CD](./50-operations/ci-cd.md) — GitHub Actions pipeline, jobs, caching
- [Deploy to staging](./00-getting-started/04-deploy-to-staging.md) — Cloud Run, Firebase deploy, smoke tests
- [Secrets & env vars](./50-operations/secrets-and-env.md) — All env vars, where to get them, Secret Manager
- [Monitoring](./50-operations/monitoring.md) — Sentry, structured logs, Cloud Logging, health probes

### [60 · Contributing](./60-contributing/) — How-to
How to work on this codebase.

- [Git workflow](./60-contributing/workflow.md) — Branching, conventional commits, PR rules
- [Coding standards](./60-contributing/coding-standards.md) — TypeScript, Dart, naming, forbidden patterns
- [Testing guide](./60-contributing/testing.md) — Vitest, emulator tests, Flutter tests, mocking patterns
- [Security checklist](./60-contributing/security-checklist.md) — Pre-implementation + post-implementation gates
- Cookbooks
  - [Adding an API route](./60-contributing/cookbooks/adding-a-route.md)
  - [Adding a domain event](./60-contributing/cookbooks/adding-a-domain-event.md)
  - [Modifying shared types](./60-contributing/cookbooks/modifying-shared-types.md)

### [70 · Future](./70-future/) — Explanation
Where the platform needs to go next, grounded in industry benchmarks.

- [Industry gap analysis](./70-future/industry-gap-analysis.md) — vs Eventbrite, Luma, Cvent, Hopin, Bizzabo
- [Must-have features](./70-future/must-have-features.md) — Gaps that block revenue or scale
- [Nice-to-have features](./70-future/nice-to-have-features.md) — Differentiators for Wave 5+

### [99 · Reference](./99-reference/) — Reference
Quick-lookup tables.

- [Firestore collections](./99-reference/collections.md)
- [Error codes](./99-reference/error-codes.md)
- [Environment variables](./99-reference/env-variables.md)

---

## Quick Links

| I want to… | Go to |
|---|---|
| Get the project running locally | [00 · Local setup](./00-getting-started/01-local-setup.md) |
| Understand the database schema | [Data model](./20-architecture/reference/data-model.md) |
| Add a new API endpoint | [Cookbook: Adding a route](./60-contributing/cookbooks/adding-a-route.md) |
| Understand why Cloud Run was chosen | [ADR-0001](./20-architecture/decisions/0001-cloud-run-vs-functions.md) |
| Know which features are plan-gated | [Freemium model](./10-product/freemium-model.md) |
| Understand the QR security scheme | [QR v4 concept](./20-architecture/concepts/qr-v4-and-offline-sync.md) |
| See what env vars the API needs | [Env variables](./99-reference/env-variables.md) |
| Find a Firestore permission rule | [Permissions reference](./20-architecture/reference/permissions.md) |

---

*Generated from code analysis — April 2026. Maintainers: update this index whenever a new document is added.*
