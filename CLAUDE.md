# CLAUDE.md — Teranga Event Platform

## Project Overview

**Teranga** is an African event management platform (mobile app + web back-office + participant web app) designed for the Senegalese and West African market. The name comes from the Wolof word for _hospitality_ — the cultural foundation of every event.

**Core differentiator:** Offline-first QR badge scanning that works reliably with intermittent connectivity, which is critical for the African market.

**Target users:** Event organizers, participants, staff (scanners), speakers, and sponsors — primarily in Senegal, expanding to francophone West Africa.

---

## Architecture

### Monorepo Structure

```
teranga/
├── apps/
│   ├── api/                  # Fastify REST API → deployed on Cloud Run
│   ├── functions/            # Firebase Cloud Functions v2 (triggers only)
│   ├── web-backoffice/       # Next.js 14 PWA for organizers + admin
│   ├── web-participant/      # Next.js 14 — participant event discovery & registration (Wave 3)
│   └── mobile/               # Flutter app (iOS + Android)
├── packages/
│   ├── shared-types/         # Zod schemas + TypeScript types (single source of truth)
│   ├── shared-ui/            # Reusable React components (Button, Card, etc.) — shared by both Next.js apps
│   └── shared-config/        # Shared Tailwind preset, ESLint config
├── infrastructure/
│   ├── firebase/             # Firestore rules, storage rules, composite indexes
│   └── terraform/            # GCP IaC (future)
├── .github/workflows/        # CI/CD
├── firebase.json             # Firebase project config (emulators, hosting, functions)
├── turbo.json                # Turborepo task pipeline
└── package.json              # npm workspaces root
```

### Tech Stack

| Layer           | Technology                                            | Rationale                                                   |
| --------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Mobile          | **Flutter 3** (Riverpod, go_router, Hive)             | Best offline/Firestore SDK, cross-platform                  |
| Web backoffice  | **Next.js 14** App Router + TailwindCSS + shadcn/ui   | PWA support, SSR, accessible components                     |
| Web participant | **Next.js 14** App Router + TailwindCSS + shared-ui   | SSR/SSG for SEO, fast on African networks, WhatsApp sharing |
| REST API        | **Fastify 4** + TypeScript on **Cloud Run**           | Low latency, no cold starts, Swagger/OpenAPI                |
| Background jobs | **Firebase Cloud Functions v2**                       | Event-driven triggers (auth, Firestore, Pub/Sub)            |
| Database        | **Cloud Firestore** (primary)                         | Real-time, offline sync, security rules                     |
| Auth            | **Firebase Authentication** + custom claims for roles | Role-based access, JWT tokens                               |
| Storage         | **Cloud Storage for Firebase**                        | Badge PDFs, event images, profile photos                    |
| Push            | **FCM** + planned SMS (Africa's Talking)              | Push + SMS fallback for African market                      |
| Monorepo        | **npm workspaces** + **Turborepo**                    | Dependency graph, parallel builds                           |

### Key Design Decisions

- **API on Cloud Run, NOT Cloud Functions for HTTPS**: Cloud Functions have cold starts and request limits. Cloud Run = always-on, better for a REST API with many endpoints.
- **Cloud Functions ONLY for triggers**: Auth events (user create/delete), Firestore writes (badge generation, notifications), and scheduled jobs.
- **Shared types via Zod schemas**: `@teranga/shared-types` is the single source of truth for data shapes. API validates with Zod, web uses the same schemas, Flutter mirrors them manually.
- **QR codes are HMAC-SHA256 signed**: Full digest, no truncation. Uses `crypto.timingSafeEqual` for verification. Secret stored in `QR_SECRET` env var.
- **Firestore security rules are defense-in-depth**: API validates on the server side AND rules validate on the client side. Both are required.
- **Multi-tenancy via Organizations**: Every organizer belongs to an organization. `organizationId` is stored in Firebase custom claims.

### Permission-Based Access Control (RBAC)

The platform uses **granular permissions** (`resource:action` format) mapped to system roles. Defined in `packages/shared-types/src/permissions.types.ts`.

| Role           | Scope        | Key Permissions                                                                     |
| -------------- | ------------ | ----------------------------------------------------------------------------------- |
| `participant`  | Global       | `registration:create`, `badge:view_own`, `feed:read`, `messaging:send`              |
| `organizer`    | Organization | All participant + `event:*`, `registration:read_all`, `badge:generate`, `checkin:*` |
| `co_organizer` | Event        | Same as organizer but scoped to specific events, no org management                  |
| `speaker`      | Event        | `event:read`, `profile:*`, `feed:create_post`, `messaging:send`                     |
| `sponsor`      | Event        | `sponsor:manage_booth`, `sponsor:collect_leads`, `event:read`                       |
| `staff`        | Event        | `checkin:scan`, `checkin:manual`, `registration:read_all`                           |
| `super_admin`  | Global       | `platform:manage` → implies ALL permissions                                         |

**Key functions:** `resolvePermissions()`, `hasPermission()`, `hasAllPermissions()`, `hasAnyPermission()`.

**Resource scopes:** Roles are assigned at `global`, `organization`, or `event` level. Organization-scoped roles apply to all events in that org.

### API Backend Architecture

```
Routes (thin controllers) → Services (business logic) → Repositories (data access) → Firestore
         ↓                        ↓                                                       ↑
   Middleware chain          Domain Event Bus ──→ Listeners (notifications, audit)    Transactions
   (auth, validate,          (fire-and-forget)                                       (atomic ops)
    permissions)
```

**Layers:**

- **Routes** (`src/routes/`): HTTP layer only — validate input, call service, format response. Never business logic.
- **Services** (`src/services/`): All business logic, permission checks via `BaseService.requirePermission()`. Emit domain events after mutations.
- **Repositories** (`src/repositories/`): Generic Firestore CRUD via `BaseRepository<T>`. Transaction helpers for atomic operations.
- **Errors** (`src/errors/`): Typed errors (`NotFoundError`, `ForbiddenError`, etc.) caught by global Fastify error handler.
- **Middleware** (`src/middlewares/`): `authenticate`, `validate({ body, params, query })`, `requirePermission("event:create")`.
- **Context** (`src/context/`): `AsyncLocalStorage`-based request context (requestId, userId, timing) propagated through async chains.
- **Events** (`src/events/`): Typed domain event bus for decoupled side effects. Listeners handle notifications, audit logging, future webhooks.

### Backend Design Principles

1. **Transactions for atomicity**: Any operation that writes multiple documents (registration + counter, cancel + decrement) MUST use `db.runTransaction()`. Never separate writes for related data.
2. **Domain events for side effects**: After a mutation (registration created, event published), emit a domain event. Listeners handle async side effects (notifications, audit). Services never call other services directly for side effects.
3. **Audit everything sensitive**: All mutations on events, registrations, organizations, and member changes are audit-logged via the event bus. Audit writes are fire-and-forget (never block responses).
4. **Request context propagation**: Use `AsyncLocalStorage` to carry requestId, userId, and timing through async call chains. Services access context via `getRequestContext()` — no need to pass requestId as a parameter.
5. **Graceful shutdown**: The server handles SIGTERM/SIGINT by draining in-flight requests before exiting. Cloud Run sends SIGTERM with a 10s grace period.
6. **Process-level error handling**: `unhandledRejection` is logged but does not crash. `uncaughtException` triggers graceful shutdown (unknown process state).
7. **Health probes**: `/health` (liveness — always 200), `/ready` (readiness — checks Firestore connectivity). Cloud Run uses these for routing decisions.
8. **Security hardening**: 1MB body limit, Content-Type enforcement on mutations, Helmet with HSTS, rate limiting with auth-aware keys.

---

## Development

### Prerequisites

- Node.js >= 20, npm >= 10
- Flutter >= 3.27 (stable)
- Firebase CLI: `npm install -g firebase-tools`
- FlutterFire CLI: `dart pub global activate flutterfire_cli`

### First-Time Setup

```bash
# 1. Install dependencies (all workspaces)
npm install

# 2. Build shared types (required before other packages)
npm run types:build

# 3. Copy environment file for API
cp apps/api/.env.example apps/api/.env
# Edit .env with your Firebase project credentials

# 4. Copy environment file for web
cp apps/web-backoffice/.env.example apps/web-backoffice/.env.local
# Edit with your Firebase web SDK config

# 5. Generate Firebase options for Flutter
cd apps/mobile && flutterfire configure --project=teranga-events-dev
```

### Running Locally

```bash
# Start Firebase emulators (Firestore, Auth, Storage, Functions)
firebase emulators:start

# In separate terminals:
npm run api:dev          # Fastify API on :3000
npm run web:dev          # Next.js on :3001

# For Flutter:
cd apps/mobile && flutter run
```

### Key npm Scripts (root)

| Script                | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `npm run api:dev`     | Start API in dev mode with hot reload                 |
| `npm run web:dev`     | Start web backoffice in dev mode                      |
| `npm run types:build` | Build shared-types package (run after schema changes) |
| `npm run build`       | Build all packages via Turborepo                      |
| `npm run lint`        | Lint all TypeScript packages                          |
| `npm run format`      | Format all files with Prettier                        |

### After Changing Shared Types

Whenever you modify files in `packages/shared-types/src/`, you MUST rebuild:

```bash
npm run types:build
```

Other packages import from `@teranga/shared-types` and depend on the compiled output.

---

## Quality bar — no minimalism

**MANDATORY for every task.** When delivering tests, stories, fixtures, docs, or any artefact where a "minimal version" and a "complete version" are both possible, **always default to complete**. Do NOT pick the simplest, shortest, or most-reductive option just to ship faster.

What "complete" looks like:

| Artefact | Minimal (avoid) | Complete (required) |
|----------|-----------------|---------------------|
| Storybook story | One `Default` export | Default + every meaningful prop variant + a11y / loading / error / disabled states + a `Showcase` story that demonstrates real usage in context |
| Service test | Happy path only | The four mandatory cases (happy / permission / org-access / error) + transaction assertions + domain-event emit assertion when applicable |
| Doc page | Skeleton with TODOs | Full prose with examples, failure modes, related references, and operator-actionable instructions |
| Seed fixture | Single example record | Realistic state diversity (active / archived / cancelled / expired) with cross-references that exercise downstream queries |
| README | Title + dev command | Tech stack + architecture link + scripts table + deployment notes + pitfalls section |
| Migration script | Forward-only | Forward + dry-run + rollback notes + audit log entry |

**Why this rule exists.** Minimal artefacts pass review but ship as TODOs in disguise. They look done, get merged, and immediately rot — every reader has to add the missing variants on demand, often without context. Complete artefacts pay the "completeness tax" once at write-time and amortise it forever.

**The ONLY exceptions:**

1. **The user explicitly asks for a stub / placeholder** (e.g. "scaffold this, we'll fill it in later").
2. **The artefact is genuinely a one-shot** (e.g. a hotfix touching one line), where extra variants would be noise.
3. **Type-system or framework constraints** make additional variants impossible (rare).

If you find yourself thinking "I'll just do the minimum here," **stop and add the missing variants**. If they're truly out of scope, document the gap explicitly in the PR description as a follow-up — never silently ship the minimum.

## Coding Standards

### TypeScript (API, Functions, Web, Shared Types)

- **Strict mode** enabled everywhere (`"strict": true` in all tsconfigs)
- **Consistent type imports**: Use `import { type Foo }` or `import type { Foo }` — enforced by ESLint
- **Zod for validation**: All request bodies validated with Zod schemas from `@teranga/shared-types`
- **No `any`**: Prefer `unknown` + narrowing. `any` triggers an ESLint warning
- **Error responses**: Always return `{ success: false, error: { code, message } }` — never throw raw strings
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, SCREAMING_SNAKE for constants

### Flutter (Mobile)

- **Feature-first** folder structure: `lib/features/{feature}/presentation/pages/`, `providers/`, `data/`
- **Riverpod 2** for state management with code generation (`@riverpod` annotations)
- **go_router** for navigation with typed routes
- **Hive** for offline-critical local storage (QR data, check-in queue)
- **Firestore SDK** for real-time streams (feed, messaging) — uses offline persistence
- Run `flutter pub run build_runner build --delete-conflicting-outputs` after adding/changing Riverpod providers or Freezed models

### API Routes & Services

- All routes are versioned: `/v1/events`, `/v1/registrations`, etc.
- Routes are **thin controllers** — validate input, call service, return response
- **Never put business logic in routes** — always in services (`src/services/`)
- **Permission middleware**: `preHandler: [authenticate, requirePermission("event:create")]`
- **Validation middleware**: `preHandler: [validate({ body: Schema, params: Schema, query: Schema })]`
- Services extend `BaseService` for shared permission resolution
- Repositories extend `BaseRepository<T>` for typed Firestore CRUD
- Soft-delete only: Never hard-delete data. Set `status: "archived"` or `status: "cancelled"`
- Pagination: All list endpoints accept `?page=1&limit=20&orderBy=createdAt&orderDir=desc`
- **After mutations, emit domain events** — e.g. `eventBus.emit('registration.created', { ... })` after a successful registration
- **Use Firestore transactions** for any multi-document write (registration + counter, cancel + decrement)
- **Never call console.log/warn directly** in services — use `getRequestContext()` and the Fastify logger

### Firestore

- **Collection names** are defined in `COLLECTIONS` constant (in both `apps/api/src/config/firebase.ts` and `apps/functions/src/utils/admin.ts`). Always use these constants.
- **Document IDs**: Use Firestore auto-generated IDs. Store the ID inside the document as `id` field for convenience.
- **Timestamps**: Always ISO 8601 strings (`new Date().toISOString()`), not Firestore Timestamps. This ensures consistent serialization across all clients.
- **Denormalization is OK**: Store `authorName` alongside `authorId` in feed posts to avoid extra reads. Update on profile change via Cloud Function if needed.
- **Transactions are mandatory** for any operation that reads-then-writes or writes multiple related documents. Use `runTransaction()` from `src/repositories/transaction.helper.ts`.
- **Audit logs** are written to the `auditLogs` collection via the domain event bus. Never write audit logs inside transactions — emit a domain event after commit.
- **Batch writes** (max 500 operations) for bulk operations like badge generation or broadcast notifications. Split into chunks if needed.

---

## Security

### Authentication Flow

Two bearer-token branches share the single `authenticate` middleware
(`apps/api/src/middlewares/auth.middleware.ts`). The middleware
dispatches on the token prefix; a malformed prefix is a 401 before
any verification cost.

**User session (Firebase ID token):**

1. Client authenticates via Firebase Auth SDK (email/password, Google, etc.)
2. Client gets Firebase ID token (JWT) with custom claims (roles, organizationId)
3. Client sends `Authorization: Bearer <idToken>` to API
4. API verifies token via `firebase-admin.auth().verifyIdToken()`
5. API middleware populates `request.user` with uid, email, roles, organizationId

**Organization API key (T2.3 — `terk_*`):**

6. Client sends `Authorization: Bearer terk_<env>_<40 chars base62>_<4-char checksum>`
7. Middleware parses + checksum-validates the format (rejects typos before a Firestore read)
8. `apiKeysService.verify()` looks up `apiKeys/<hashPrefix>` (O(1)), constant-time compares `SHA-256(plaintext)` against the stored hash, rejects on revoke
9. Middleware synthesises `request.user` with `uid: "apikey:<hashPrefix>"`, `isApiKey: true`, `apiKeyScopes`, `apiKeyPermissions` (expanded from scopes)
10. `/v1/me/whoami` is the zero-side-effect integrator probe to validate a key + inspect its permission set
11. Kill-switch: `API_KEY_AUTH_DISABLED=true` short-circuits the `terk_*` branch to 401 platform-wide without a code deploy

Full operator + integrator guide: `docs/api-keys.md`.

### QR Badge Security

- **v3 format** (current): `registrationId:eventId:userId:notBeforeBase36:notAfterBase36:hmacSignature` (6 parts)
- **v2 format** (legacy, still accepted): `registrationId:eventId:userId:epochBase36:hmacSignature` (5 parts)
- **v1 format** (legacy, still accepted): `registrationId:eventId:userId:hmacSignature` (4 parts)
- Signed with HMAC-SHA256 using `QR_SECRET` — full 64-char hex digest, no truncation
- Verified with `crypto.timingSafeEqual` (constant-time comparison to prevent timing attacks)
- v3 bakes the validity window (`notBefore` / `notAfter`, epoch ms in base36) into the signed payload. Scan path rejects QRs outside `[notBefore − 2 h, notAfter + 2 h]` (clock-skew grace). For v1/v2 QRs the scan path backfills the window from `event.startDate − 24 h` / `event.endDate + 6 h` — same formula the signer uses.
- Staff app validates offline against locally cached registration list (synced via Firestore)
- QR signing functions are in `apps/api/src/services/qr-signing.ts` (exported, imported by registration service and tests). See `docs/badge-journey-review-2026-04-20.md` for the full credential journey + sequencing.

### Firestore Rules Key Principles

- **Deny-all default**: Top-level `match /{document=**} { allow read, write: if false; }` — every collection must have explicit rules
- **`onlyChanges()` helper**: Restricts which fields a user can modify (e.g., participants can't change their own roles)
- **No hard deletes**: `allow delete: if false` on registrations, badges, notifications, messages
- **Badges and notifications**: Created only via Admin SDK (Cloud Functions) — `allow create: if false` in rules

### Secrets Management

- **Never commit** `.env`, `service-account*.json`, or Firebase API keys to git
- `.env.example` files exist for all apps — copy and fill in real values
- In production: Use GCP Secret Manager or Cloud Run env injection
- `QR_SECRET` must be >= 16 characters and unique per environment

---

## Localization

- **Primary language**: French (fr) — Senegal market
- **Supported**: English (en), Wolof (wo)
- **Mobile**: Flutter gen-l10n with ARB files in `apps/mobile/lib/l10n/`
- **Web**: i18n to be implemented (next phase)
- Default locale: `fr`, timezone: `Africa/Dakar`, currency: `XOF` (CFA Franc)

---

## Currency & Payments

- **Default currency**: XOF (CFA Franc BCEAO) — used across WAEMU countries
- **Planned payment providers**: Wave, Orange Money, Free Money (Senegal mobile payments)
- **Price model**: Freemium for organizers (free, starter, pro, enterprise plans)
- Use `Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" })` for formatting

---

## Freemium Model

The platform uses a 4-tier SaaS freemium model to monetize while keeping the free tier generous enough for adoption in the Senegalese market.

### Plan Tiers

|                             | Free | Starter (9 900 XOF/mo) | Pro (29 900 XOF/mo) | Enterprise (custom) |
| --------------------------- | ---- | ---------------------- | ------------------- | ------------------- |
| **maxEvents**               | 3    | 10                     | Infinity            | Infinity            |
| **maxParticipantsPerEvent** | 50   | 200                    | 2,000               | Infinity            |
| **maxMembers**              | 1    | 3                      | 50                  | Infinity            |
| qrScanning                  | -    | ✅                     | ✅                  | ✅                  |
| paidTickets                 | -    | -                      | ✅                  | ✅                  |
| customBadges                | -    | ✅                     | ✅                  | ✅                  |
| csvExport                   | -    | ✅                     | ✅                  | ✅                  |
| smsNotifications            | -    | -                      | ✅                  | ✅                  |
| advancedAnalytics           | -    | -                      | ✅                  | ✅                  |
| speakerPortal               | -    | -                      | ✅                  | ✅                  |
| sponsorPortal               | -    | -                      | ✅                  | ✅                  |
| apiAccess                   | -    | -                      | -                   | ✅                  |
| whiteLabel                  | -    | -                      | -                   | ✅                  |
| promoCodes                  | -    | ✅                     | ✅                  | ✅                  |

### Shared Types

Plan configuration lives in `packages/shared-types/src/organization.types.ts`:

- **`PlanFeatures`**: Interface with 11 boolean feature flags
- **`PlanFeature`**: Union type (`keyof PlanFeatures`)
- **`PlanLimits`**: `{ maxEvents, maxParticipantsPerEvent, maxMembers, features: PlanFeatures }`
- **`PLAN_LIMITS`**: Const record mapping each `OrganizationPlan` to its `PlanLimits`
- **`PLAN_DISPLAY`**: Const record with display info (name fr/en, priceXof, color, description)

Subscription types in `packages/shared-types/src/subscription.types.ts`:

- **`SubscriptionStatusSchema`**: Zod enum (active, past_due, cancelled, trialing)
- **`SubscriptionSchema`**: Full subscription document schema
- **`PlanUsageSchema`**: Usage response with current/limit for events and members

### API Enforcement

Enforcement happens at the service layer (`apps/api/src/services/`):

| Check                | Location                                                      | Behavior                                                         |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Event creation limit | `event.service.ts` `create()` + `clone()`                     | `PlanLimitError` if `activeEvents >= maxEvents`                  |
| Participant limit    | `registration.service.ts` `register()`                        | `PlanLimitError` if `registeredCount >= maxParticipantsPerEvent` |
| Paid ticket gating   | `event.service.ts` ticket creation                            | `PlanLimitError` if `price > 0` and `!features.paidTickets`      |
| Feature gating       | `base.service.ts` `requirePlanFeature()`                      | `PlanLimitError` for disabled features                           |
| Member limit         | `organization.service.ts` `addMember()` + `invite.service.ts` | `PlanLimitError` if `members >= maxMembers`                      |

**Grace period rule:** Registration participant limit is NOT enforced after an event has started (`startDate < now`). Never block during a live event.

**Helper methods on `BaseService`:**

- `requirePlanFeature(plan, feature)` — throws `PlanLimitError` if feature is disabled
- `checkPlanLimit(plan, resource, current)` — returns `{ allowed, current, limit }` without throwing

### Subscription Management

Routes at `apps/api/src/routes/subscriptions.routes.ts`:

| Endpoint                                          | Method | Description                           |
| ------------------------------------------------- | ------ | ------------------------------------- |
| `/v1/organizations/:orgId/subscription`           | GET    | Current subscription                  |
| `/v1/organizations/:orgId/usage`                  | GET    | On-demand usage computation           |
| `/v1/organizations/:orgId/subscription/upgrade`   | POST   | Upgrade plan (body: `{ plan }`)       |
| `/v1/organizations/:orgId/subscription/downgrade` | POST   | Downgrade plan (validates usage fits) |
| `/v1/organizations/:orgId/subscription/cancel`    | POST   | Revert to free plan                   |

**Design decisions:**

- Usage is computed on-demand (query active events, read memberIds.length) — no counters collection
- Downgrade validates that current usage fits the target plan limits before allowing
- Upgrade/downgrade/cancel emit domain events (`subscription.upgraded`, `subscription.cancelled`)
- MVP: instant plan change without actual payment — payment integration (Wave/OM) deferred

### Frontend Plan Gating (web-backoffice)

**`usePlanGating` hook** (`apps/web-backoffice/src/hooks/use-plan-gating.ts`):

- `plan` — current organization plan
- `canUse(feature: PlanFeature): boolean` — feature flag check
- `checkLimit(resource): { allowed, current, limit, percent }` — usage check
- `isNearLimit(resource): boolean` — true at >= 80% usage

**`PlanGate` component** (`apps/web-backoffice/src/components/plan/PlanGate.tsx`):

- `fallback="blur"`: Renders children with blur overlay + upgrade CTA (soft wall)
- `fallback="hidden"`: Renders nothing
- `fallback="disabled"`: Reduced opacity, no interactions

**Integration points:**

- Analytics page: `<PlanGate feature="advancedAnalytics" fallback="blur">` on charts
- Communications page: `<PlanGate feature="smsNotifications" fallback="disabled">` on SMS toggle
- Sidebar: Plan widget with usage meters + upgrade link when near limit
- Organization page: Plan card with usage and "Gérer mon plan" link

**Billing page** (`apps/web-backoffice/src/app/(dashboard)/organization/billing/page.tsx`):

- Current plan card with usage meters
- Plan comparison table (responsive: table on desktop, cards on mobile)
- Upgrade/downgrade flow with feature diff preview
- Cancel subscription button

### Seed Data

The seed script (`scripts/seed-emulators.ts`) includes plan-diverse test data:

| Organization          | Plan       | Email                    |
| --------------------- | ---------- | ------------------------ |
| Teranga Events SRL    | pro        | `admin@teranga.dev`      |
| Dakar Digital Hub     | starter    | `organizer@teranga.dev`  |
| Startup Dakar         | free       | `free@teranga.dev`       |
| Groupe Sonatel Events | enterprise | `enterprise@teranga.dev` |

3 subscription documents are seeded for the non-free organizations.

---

## Firebase Emulators

The project is configured for local development with Firebase emulators:

| Service     | Port |
| ----------- | ---- |
| Auth        | 9099 |
| Firestore   | 8080 |
| Storage     | 9199 |
| Functions   | 5001 |
| Hosting     | 5000 |
| Pub/Sub     | 8085 |
| Emulator UI | 4000 |

Start all: `firebase emulators:start`

---

## Git Branching Strategy

This project follows a **trunk-based development** model with short-lived feature branches.

### Branch Naming Convention

| Prefix      | Purpose                                   | Example                          |
| ----------- | ----------------------------------------- | -------------------------------- |
| `feature/`  | New features and wave implementations     | `feature/wave-1-core-loop`       |
| `fix/`      | Bug fixes                                 | `fix/qr-signature-validation`    |
| `refactor/` | Code improvements with no behavior change | `refactor/extract-badge-service` |
| `chore/`    | Tooling, CI, dependencies, config         | `chore/update-eslint-config`     |
| `docs/`     | Documentation only                        | `docs/api-endpoints`             |
| `hotfix/`   | Urgent production fixes                   | `hotfix/registration-crash`      |

### Workflow Rules

1. **`develop` is the integration trunk** — always deployable, protected by CI gate. `main` is the production-release branch; promotions from `develop → main` happen via release PRs.
2. **One branch per wave or logical unit** — e.g., `feature/wave-1-core-loop` for all Wave 1 work
3. **Branch from `develop`**, merge back to `develop` via PR (or direct merge for solo development)
4. **Commit early, commit often** — small, atomic commits with conventional commit messages
5. **Conventional Commits** format: `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `ci`, `perf`
   - Scope: the affected area — `api`, `web`, `mobile`, `shared-types`, `functions`, `infra`, `platform` (cross-cutting)
   - Examples: `feat(api): add badge PDF generation endpoint`, `fix(shared-types): correct registration status enum`
6. **Commit message quality rules** (MANDATORY on every commit):
   - **First line**: `type(scope): concise imperative summary` (max 72 chars)
   - **Body** (after blank line): Explain **what** changed and **why** — not just "what files were touched"
   - **Group related changes**: When a commit spans multiple phases/areas, use bullet points or paragraphs to describe each logical change
   - **Include test status**: End the body with "All N tests pass." when tests were run
   - **No vague messages**: Never use "update files", "fix stuff", "WIP", or "misc changes"
   - **Reference context**: Mention phase numbers, ticket IDs, or audit findings when applicable
   - Example:

     ```
     feat(api): add event clone endpoint with plan limit enforcement

     Add POST /v1/events/:eventId/clone that duplicates an event with
     new dates. Enforces plan limits (maxEvents) via BaseService.checkPlanLimit().
     Emits event.cloned domain event for audit trail.

     All 520 tests pass.
     ```

7. **Update PR description on every push** (MANDATORY):
   - After every `git push`, if a pull request already exists for the current branch, **update its title and body** to reflect the full cumulative scope of all commits on the branch
   - The PR body must include: a `## Summary` section with grouped bullet points covering all changes, and a `## Test plan` checklist
   - Use the GitHub MCP tool `mcp__github__update_pull_request` to update the PR
   - Never leave a stale PR description — it must always match the latest state of the branch
8. **Never force-push to `develop` or `main`** — rebase or merge, never rewrite shared history
9. **Delete branches after merge** — keep the branch list clean
10. **Tag releases** with semver: `v0.1.0` (Wave 1), `v0.2.0` (Wave 2), etc.

### Wave Development Flow

```
main (production releases) ◄──── release PR ────┐
                                                │
develop (integration trunk) ────────────────────┘──►
  └── feature/wave-1-core-loop ──── commits ──── merge back to develop
                                                    └── feature/wave-2-offline-checkin ──── ...
```

---

## Deployment

### API (Cloud Run)

```bash
# Build and push Docker image
docker build -f apps/api/Dockerfile -t gcr.io/teranga-events-prod/api .
docker push gcr.io/teranga-events-prod/api

# Deploy
gcloud run deploy teranga-api \
  --image gcr.io/teranga-events-prod/api \
  --region europe-west1 \
  --allow-unauthenticated
```

### Cloud Functions

```bash
firebase deploy --only functions
```

### Web (Firebase Hosting)

```bash
cd apps/web-backoffice && npm run build
firebase deploy --only hosting
```

### Mobile

```bash
cd apps/mobile
flutter build apk --release          # Android
flutter build ios --release           # iOS (requires macOS)
```

---

## Common Pitfalls

1. **Forgot to rebuild shared-types**: If you see import errors for `@teranga/shared-types`, run `npm run types:build`
2. **Firestore offline cache stale**: In emulators, clear IndexedDB in browser dev tools if data seems stuck
3. **Custom claims not refreshed**: After updating a user's roles via API, the user must sign out and back in (or force-refresh the token) to see new claims
4. **Flutter build_runner**: After adding new Riverpod providers or Freezed classes, run `flutter pub run build_runner build --delete-conflicting-outputs`
5. **Firebase Functions v2 region**: All triggers use `europe-west1` — keep this consistent. Mismatched regions cause silent failures.
6. **QR scanning offline**: Staff app MUST sync event data BEFORE going offline. There is no fallback if the local cache is empty.

---

## Environment Aliases

| Alias      | Firebase Project      | Usage                                   |
| ---------- | --------------------- | --------------------------------------- |
| default    | `teranga-app-990a8`   | Local dev + staging (shared single env) |
| staging    | `teranga-app-990a8`   | Alias — same project as default         |
| production | `teranga-events-prod` | Live production                         |

Switch with: `firebase use <alias>`

---

## Delivery Roadmap

The platform is delivered in **10 waves** with a **web-first MVP strategy**. Mobile is deferred to Wave 9 after the web platform is validated. Full details with task checklists are in `docs/delivery-plan/`.

| Wave     | Name                         | Platform           | Est. Effort |
| -------- | ---------------------------- | ------------------ | ----------- |
| Pre-Wave | Foundation Hardening         | All                | 3-4 days    |
| Wave 1   | **Core Loop**                | API + Web + Mobile | 2 weeks     |
| Wave 2   | **Check-in API & Dashboard** | API + Web          | 1.5 weeks   |
| Wave 3   | **Participant Web App**      | Web (SSR/SSG)      | 1.5 weeks   |
| Wave 4   | Organizer Productivity       | API + Web          | 2 weeks     |
| Wave 5   | Social & Sessions            | API + Web          | 2 weeks     |
| Wave 6   | Payments                     | API + Web          | 2 weeks     |
| Wave 7   | Communications               | API + Web          | 1.5 weeks   |
| Wave 8   | Portals                      | API + Web          | 1.5 weeks   |
| Wave 9   | **Mobile App Completion**    | Mobile (Flutter)   | 3-4 weeks   |
| Wave 10  | Production Launch            | All                | 2 weeks     |

**Tracking:** Each wave file contains a task checklist. Mark tasks `[x]` as they are completed. Update status in `docs/delivery-plan/README.md` as waves progress.

---

## Testing

### Current Test Suite

- **401 tests** across 29 test files (as of 2026-04-11)
- Test runner: **Vitest** with TypeScript
- Run: `cd apps/api && npx vitest run`
- Test files follow `__tests__/` convention next to source files

### Test Categories

| Category               | Location                                                  | Examples                                                                                                             |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| QR signing             | `src/services/__tests__/qr-signing.test.ts`               | v2/v1 sign-verify, tamper detection                                                                                  |
| Event service          | `src/services/__tests__/event.service.test.ts`            | Create, update, publish, cancel, archive                                                                             |
| Organization service   | `src/services/__tests__/organization.service.test.ts`     | Create, members, plan limits                                                                                         |
| Plan limits            | `src/services/__tests__/plan-limits.test.ts`              | PLAN_LIMITS/PLAN_DISPLAY structure, feature gating per tier, event creation limits, paid ticket gating, clone limits |
| Auth middleware        | `src/middlewares/__tests__/auth.middleware.test.ts`       | Token validation, role defaults                                                                                      |
| Permission middleware  | `src/middlewares/__tests__/permission.middleware.test.ts` | RBAC enforcement, super_admin bypass                                                                                 |
| Validation middleware  | `src/middlewares/__tests__/validate.middleware.test.ts`   | Zod schema validation                                                                                                |
| Event bus              | `src/events/__tests__/event-bus.test.ts`                  | Listener delivery, error isolation                                                                                   |
| Audit listener         | `src/events/__tests__/audit.listener.test.ts`             | Domain event → audit log mapping                                                                                     |
| Health routes          | `src/routes/__tests__/health.routes.test.ts`              | Liveness, readiness with Firestore check                                                                             |
| Event routes           | `src/routes/__tests__/events.routes.test.ts`              | Auth enforcement, CRUD, response shapes                                                                              |
| Check-in routes        | `src/routes/__tests__/checkin.routes.test.ts`             | Sync, scan, offline buffer                                                                                           |
| Upload service         | `src/services/__tests__/upload.service.test.ts`           | Signed URL generation, org access validation                                                                         |
| Badge template service | `src/services/__tests__/badge-template.service.test.ts`   | Template CRUD, org access, permission checks                                                                         |
| Security audit         | `src/services/__tests__/security-audit.test.ts`           | Org access checks, transaction safety, permission enforcement                                                        |

### Writing Tests

- Use `vi.mock()` for Firebase dependencies
- Use factories from `src/__tests__/factories.ts` for test data (`buildAuthUser`, `buildOrganizerUser`, `buildSuperAdmin`)
- Service tests should mock repositories; route tests should use `fastify.inject()`
- QR tests import directly from `src/services/qr-signing.ts` — no duplication needed
- When services use `db.runTransaction()`, tests must mock `db` and `COLLECTIONS` from `@/config/firebase` and provide a mock transaction with `get`/`update` methods

### Test Authoring Checklist (MANDATORY before opening a PR)

Every Claude session that adds or modifies a service method, route, listener, hook, or component MUST run through this checklist. The full conventions, mock templates, and anti-patterns live in **`.claude/skills/teranga-testing/SKILL.md`** (auto-triggered on any test file edit). The mechanical enforcement runs via **`.claude/agents/test-coverage-reviewer.md`** — invoke it locally with `@test-coverage-reviewer` before pushing.

#### The four mandatory cases per service method

Every new service method ships with at least:

1. **Happy path** — canonical success scenario; assert return value + side effects (eventBus emit, Firestore write).
2. **Permission denial** — caller without the required permission gets `ForbiddenError` / "Permission manquante".
3. **Org-access denial** — cross-org caller is rejected. Skip ONLY when the method is platform-wide by design (admin endpoints) and document the omission inline.
4. **Error path** — at least one Firestore failure or invalid-state guard test.

Plus, when applicable:

- Mutation emits a domain event → assert `eventBus.emit` with the right name + payload.
- Mutation runs in `db.runTransaction(...)` → assert `mockTxUpdate`/`mockTxSet` called inside the tx callback.
- Mutation enforces a plan limit → assert `PlanLimitError` thrown on the over-limit branch.

#### Routes

For each new route, exercise:

- ✅ Happy 200/201/204 with `{ success: true, data: ... }` body shape.
- ✅ 401 unauthenticated.
- ✅ 403 wrong role (for mutations).
- ✅ 400 invalid body (when the route accepts a body).

The deny-matrix in `apps/api/src/routes/__tests__/admin.routes.test.ts` is the canonical example — copy that structure.

#### The 5 canonical mock patterns (memorise)

| Pattern | When to use | Reference test |
|---|---|---|
| **Firestore tx mock** (`mockTxGet`/`mockTxUpdate`/`mockTxSet`) | Service uses `db.runTransaction()` | `event.service.test.ts` |
| **eventBus emit mock** | Service emits domain events | `admin.service.test.ts` |
| **Request context mock** (`getRequestId` / `getRequestContext` / `trackFirestoreReads`) | Service reads ALS context | Most service tests |
| **AuthUser factory** (`buildAuthUser`/`buildSuperAdmin`/`buildOrganizerUser`) | Anywhere an AuthUser is needed | `factories.ts` |
| **`fastify.inject()`** | Route-level integration tests | `admin.routes.test.ts` |

Never hand-roll an AuthUser inline. Never use `clearAllMocks()` when you queued `mockResolvedValueOnce` — use `mockReset()` or you'll leak between tests.

#### Snapshot tests — pin discipline

Three load-bearing snapshots — refresh them in the SAME commit that changes the code:

| Change | Snapshot to refresh |
|---|---|
| New admin route | `apps/api/src/__tests__/__snapshots__/route-inventory.test.ts.snap` |
| Permission catalog edit | `apps/api/src/__tests__/__snapshots__/permission-matrix.test.ts.snap` |
| `AuditAction` enum / shared-types schema | `packages/shared-types/src/__tests__/__snapshots__/contract-snapshots.test.ts.snap` |
| New audit listener | `apps/api/src/events/__tests__/audit.listener.test.ts` (`EXPECTED_HANDLER_COUNT` constant + comment) |

Update with `cd apps/api && npx vitest run -u <test-file>`. **Read the diff line-by-line** — never blindly accept a snapshot diff.

#### Determinism rules (non-negotiable)

- **Fix the clock** for age/window logic (`vi.setSystemTime(...)` in `beforeEach`, `vi.useRealTimers()` in `afterEach`).
- **No `Math.random` / `crypto.randomUUID` / `nanoid`** without stubbing when the test asserts on output.
- **No real network**, no real timers, no real `navigator.clipboard`, no emulator dependence in unit tests.
- All tests must pass with zero external services running.

#### Coverage gate before pushing

```bash
cd apps/api && npx vitest run        # all tests pass (currently 1598+)
cd apps/api && npx tsc --noEmit       # typecheck clean
cd apps/web-backoffice && npx tsc --noEmit
```

Then mentally tick:

- [ ] Four mandatory cases per new service method
- [ ] Four route cases (200 / 401 / 403 / 400)
- [ ] Snapshots refreshed (route-inventory, permission-matrix, contract-snapshots, audit-listener count)
- [ ] Mocks reset properly between tests
- [ ] No hand-rolled AuthUser literals — only factories
- [ ] Listener / hook / component templates followed
- [ ] `@test-coverage-reviewer` agent invoked locally and reports `✅`

If a row is unticked, **tick it before opening the PR**. The reviewer agents downstream (security / transactions / domain-events / plan-limits) audit the CODE, not the test coverage — `test-coverage-reviewer` is the only gate that catches "shipped without tests".

---

## Pre-Implementation Checklist

Before writing any code, Claude MUST evaluate the task against these dimensions. This applies to every feature, fix, or refactor — no exceptions.

### 1. Security Review (MANDATORY for every change)

- **Multi-tenancy isolation**: Does this operation access data across organizations? Every service method that reads/writes org-scoped data MUST call `requireOrganizationAccess()`.
- **Permission check**: Is the correct permission enforced? Check `permissions.types.ts` for the right `resource:action` string.
- **Input validation**: Is all user input validated via Zod schemas from `@teranga/shared-types`? Never trust client data.
- **Content-type validation**: If accepting file uploads, whitelist MIME types. Never allow `svg+xml` (XSS vector).
- **Immutable fields**: Firestore rules must guard fields that should never change after creation (e.g., `organizationId` on events, `userId` on registrations).
- **Transaction safety**: Any read-then-write operation MUST use `db.runTransaction()`. Non-transactional read-then-write = race condition.
- **No console.log in services**: Use `process.stderr.write()` for fire-and-forget error logging, or Fastify logger via request context for request-scoped logging.

### 2. Architecture Alignment

- **Layer discipline**: Routes are thin controllers. Business logic lives ONLY in services. Data access ONLY in repositories.
- **Domain events**: Every mutation (create, update, delete, status change) MUST emit a domain event for audit trail. Never skip audit for "minor" changes.
- **Shared types first**: If a new data shape is needed, define the Zod schema in `packages/shared-types/` FIRST, then `npm run types:build`, then use in API/web.
- **API-first**: Backend endpoints must exist before any frontend consumes them. Never build frontend against imagined API shapes.
- **Offline-first for mobile**: Every mobile feature must consider what happens with no network. Cache-first reads, queue writes for sync.

### 3. Design & UX Principles

- **Francophone-first**: Default language is French. All user-facing strings must have French translations. Use `Africa/Dakar` timezone, `XOF` currency.
- **Progressive disclosure**: Forms should use multi-step wizards for complex inputs (e.g., event creation: Details → Tickets → Settings → Review).
- **Error states**: Every data-fetching UI must handle loading, empty, and error states. Never show a blank page.
- **Error UX contract** (see `docs/design-system/error-handling.md`): Mutation failures MUST use `useErrorHandler()` + `<InlineErrorBanner>` — **never** a bare `toast.error(...)` for a blocking submit error. Preflight invalid actions client-side when preconditions are knowable (status, dates, capacity, plan limits). Disambiguated errors carry `details.reason` for targeted UI copy.
- **Accessibility**: All interactive elements need ARIA labels. Toggle switches, buttons, form inputs must be keyboard-navigable.
- **Mobile-responsive**: Web backoffice must work on tablets (organizers use them at events).

### 4. Testing Requirements

- **Every new service method** needs a unit test with at least: happy path, permission denial, and org access denial cases.
- **Transactional operations** must be tested with mock transactions (`mockTxGet`, `mockTxUpdate`).
- **Run tests before committing**: `cd apps/api && npx vitest run` — all tests must pass.
- **New API routes** need route-level integration tests using `fastify.inject()`.

---

## Security Hardening Checklist (applied post-Wave 1 review)

These security patterns were established during the Wave 1 review and MUST be maintained in all future work:

| Pattern                  | Rule                                                                        | Applies To                    |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------- |
| Org access on reads      | `requireOrganizationAccess()` on every non-public data access               | Services                      |
| Org access on writes     | `requireOrganizationAccess()` before any mutation                           | Services                      |
| Transactional read-write | `db.runTransaction()` for any read-then-modify-then-write                   | Services                      |
| Content-type whitelist   | Validate against `ALLOWED_CONTENT_TYPES` set                                | Upload endpoints              |
| Immutable field guards   | Firestore rules prevent mutation of `organizationId`, `userId`, `createdBy` | Firestore rules               |
| No SVG uploads           | SVG removed from storage rules and upload whitelist                         | Storage rules, upload service |
| API client timeout       | 30s `AbortController` timeout on all fetch calls                            | Web API client                |
| Token refresh on 401     | Single retry with `getIdToken(true)` on authentication failure              | Web API client                |
| Signed QR codes          | HMAC-SHA256 with `timingSafeEqual`, never truncated                         | QR service                    |
| No hard deletes          | Soft-delete only (`status: "archived"` or `"cancelled"`)                    | All services                  |
| API key storage          | SHA-256 hash only, plaintext returned once, constant-time compare on auth   | `api-keys.service.ts` + rules |
| API key checksum gate    | 4-char HMAC checksum rejects typos before any Firestore read                | `parseApiKey()`               |
| Trust proxy              | `trustProxy: true` on Fastify so `req.ip` is the real client, not the proxy | `apps/api/src/app.ts`         |
| Auth middleware safety   | `authenticateApiKey` wrapped in try/catch so Firestore outage can't crash   | `auth.middleware.ts`          |

---

## Agent & Skill Utilization Guide

When working on this project, Claude should leverage specialized agents and skills effectively:

### Design Skills (UX/UI work)

For **any** change that touches `apps/web-backoffice`, `apps/web-participant`, or `packages/shared-ui`, the canonical entry point is the **`teranga-design-review`** skill at `.claude/skills/teranga-design-review/SKILL.md`. It wraps four external skills installed under `.claude/skills/`:

- `frontend-design` (Anthropic) — design-thinking guardrails.
- `theme-factory` (Anthropic) — theme exploration within the locked Teranga palette.
- `webapp-testing` (Anthropic) — automated browser verification of a11y & responsiveness.
- `ui-ux-pro-max` (third-party) — 161 industry rules, 99 UX guidelines, 67 UI styles, used as challenger/reviewer.

Full inventory and update procedure: `.claude/skills/README.md`. Non-negotiable brand tokens (teranga-navy / gold / green / Inter, French-first, `XOF`, WCAG 2.1 AA) are enforced by the adapter skill — never overridden by sub-skill advice.

### When to Use Agents

| Scenario                   | Agent Type                  | Why                                                 |
| -------------------------- | --------------------------- | --------------------------------------------------- |
| Broad codebase exploration | `Explore`                   | Find patterns across multiple files/directories     |
| Multi-file implementation  | `general-purpose`           | Complex changes spanning API + web + mobile         |
| Implementation planning    | `Plan`                      | Architectural decisions, multi-step feature design  |
| Parallel independent tasks | Multiple agents in parallel | e.g., API fix + web fix + mobile fix simultaneously |

### Project Subagents (committed in `.claude/agents/`)

These are shared across the team and also run in CI via `.github/workflows/claude-review.yml`. Invoke locally with `@<agent-name>` in any Claude Code session.

| Agent                           | Use when                                                                |
| ------------------------------- | ----------------------------------------------------------------------- |
| `security-reviewer`             | After any service / route / Firestore-rules / upload change             |
| `firestore-transaction-auditor` | After any service edit — scans for non-atomic read-then-write sequences |
| `plan-limit-auditor`            | After changes to events, registrations, members, tickets, subscriptions |
| `domain-event-auditor`          | After any mutation — confirms `eventBus.emit(...)` calls exist          |
| `l10n-auditor`                  | After any UI change in `apps/web-*` or `apps/mobile/`                   |
| `test-coverage-reviewer`        | After any service / route / listener / hook / component change — confirms the four mandatory test cases + snapshot refresh |

These agents are read-only — they produce reports, never modify code. Each encodes a specific rule from this file; if the rule changes here, update the matching agent prompt.

### Development Workflow

1. **Before any implementation**:
   - Read the relevant wave file in `docs/delivery-plan/` to understand context
   - Read this CLAUDE.md for architecture and security constraints
   - Check `docs/delivery-plan/README.md` for current project state
   - Review existing tests to understand patterns

2. **During implementation**:
   - Use `Plan` agent for non-trivial features (3+ files affected)
   - Use `Explore` agent when searching across the monorepo
   - Create tasks to track multi-step work
   - Run tests after each significant change

3. **After implementation**:
   - Run full test suite: `cd apps/api && npx vitest run`
   - Verify no `console.log` added in services
   - Verify org access checks on new service methods
   - Verify Firestore transactions on read-then-write operations
   - Use `/commit` skill with conventional commit format

### Review Protocol

For any substantial change (new feature, security fix, refactor), perform a self-review:

1. **Security**: Walk through every new service method — is there an org access check? Is input validated?
2. **Atomicity**: Any read-then-write? Wrap in transaction.
3. **Audit**: Does the mutation emit a domain event?
4. **Tests**: Are happy path, error path, and permission denial tested?
5. **Types**: Are shared-types schemas updated and rebuilt?

**Before pushing service-layer changes**, invoke the project subagents to mechanize the checks above:

- `@security-reviewer` — runs §1
- `@firestore-transaction-auditor` — runs §2
- `@domain-event-auditor` — runs §3
- `@plan-limit-auditor` — when the change touches freemium-gated features
- `@l10n-auditor` — when the change touches UI code
- `@test-coverage-reviewer` — runs §4 (mechanically enforces the Test Authoring Checklist)

The same agents can also be invoked on-demand via `.github/workflows/claude-review.yml` — a **manually-triggered** (`workflow_dispatch`) advisory workflow. Run it from **Actions → Claude AI Review → Run workflow** (pass the PR number) or via `gh workflow run claude-review.yml -f pr_number=<N>`. It's manual by design to stay cost-efficient; local runs are faster and free, so prefer them during development.

---

## WSL2 Development Notes

This project runs on WSL2. Key configuration:

- All servers bind to `0.0.0.0` (not `localhost`) for Windows host access
- Firebase emulators: configured in `firebase.json` with `"host": "0.0.0.0"`
- Next.js: `--hostname 0.0.0.0` flag in `apps/web-backoffice/package.json`
- API: Fastify binds to `0.0.0.0` by default
- Flutter emulator: uses `10.0.2.2` to reach host machine
- Seed emulators: `npx tsx scripts/seed-emulators.ts` (idempotent, handles existing users)

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
| --------------------------- | ------------------------------------------------------ |
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
