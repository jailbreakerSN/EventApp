# CLAUDE.md — Teranga Event Platform

## Project Overview

**Teranga** is an African event management platform (mobile app + web back-office) designed for the Senegalese and West African market. The name comes from the Wolof word for *hospitality* — the cultural foundation of every event.

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
│   └── mobile/               # Flutter app (iOS + Android)
├── packages/
│   └── shared-types/         # Zod schemas + TypeScript types (single source of truth)
├── infrastructure/
│   ├── firebase/             # Firestore rules, storage rules, composite indexes
│   └── terraform/            # GCP IaC (future)
├── .github/workflows/        # CI/CD
├── firebase.json             # Firebase project config (emulators, hosting, functions)
├── turbo.json                # Turborepo task pipeline
└── package.json              # npm workspaces root
```

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Mobile | **Flutter 3** (Riverpod, go_router, Hive) | Best offline/Firestore SDK, cross-platform |
| Web backoffice | **Next.js 14** App Router + TailwindCSS + shadcn/ui | PWA support, SSR, accessible components |
| REST API | **Fastify 4** + TypeScript on **Cloud Run** | Low latency, no cold starts, Swagger/OpenAPI |
| Background jobs | **Firebase Cloud Functions v2** | Event-driven triggers (auth, Firestore, Pub/Sub) |
| Database | **Cloud Firestore** (primary) | Real-time, offline sync, security rules |
| Auth | **Firebase Authentication** + custom claims for roles | Role-based access, JWT tokens |
| Storage | **Cloud Storage for Firebase** | Badge PDFs, event images, profile photos |
| Push | **FCM** + planned SMS (Africa's Talking) | Push + SMS fallback for African market |
| Monorepo | **npm workspaces** + **Turborepo** | Dependency graph, parallel builds |

### Key Design Decisions

- **API on Cloud Run, NOT Cloud Functions for HTTPS**: Cloud Functions have cold starts and request limits. Cloud Run = always-on, better for a REST API with many endpoints.
- **Cloud Functions ONLY for triggers**: Auth events (user create/delete), Firestore writes (badge generation, notifications), and scheduled jobs.
- **Shared types via Zod schemas**: `@teranga/shared-types` is the single source of truth for data shapes. API validates with Zod, web uses the same schemas, Flutter mirrors them manually.
- **QR codes are HMAC-SHA256 signed**: Full digest, no truncation. Uses `crypto.timingSafeEqual` for verification. Secret stored in `QR_SECRET` env var.
- **Firestore security rules are defense-in-depth**: API validates on the server side AND rules validate on the client side. Both are required.
- **Multi-tenancy via Organizations**: Every organizer belongs to an organization. `organizationId` is stored in Firebase custom claims.

### Permission-Based Access Control (RBAC)

The platform uses **granular permissions** (`resource:action` format) mapped to system roles. Defined in `packages/shared-types/src/permissions.types.ts`.

| Role | Scope | Key Permissions |
|------|-------|----------------|
| `participant` | Global | `registration:create`, `badge:view_own`, `feed:read`, `messaging:send` |
| `organizer` | Organization | All participant + `event:*`, `registration:read_all`, `badge:generate`, `checkin:*` |
| `co_organizer` | Event | Same as organizer but scoped to specific events, no org management |
| `speaker` | Event | `event:read`, `profile:*`, `feed:create_post`, `messaging:send` |
| `sponsor` | Event | `sponsor:manage_booth`, `sponsor:collect_leads`, `event:read` |
| `staff` | Event | `checkin:scan`, `checkin:manual`, `registration:read_all` |
| `super_admin` | Global | `platform:manage` → implies ALL permissions |

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

| Script | Description |
|--------|------------|
| `npm run api:dev` | Start API in dev mode with hot reload |
| `npm run web:dev` | Start web backoffice in dev mode |
| `npm run types:build` | Build shared-types package (run after schema changes) |
| `npm run build` | Build all packages via Turborepo |
| `npm run lint` | Lint all TypeScript packages |
| `npm run format` | Format all files with Prettier |

### After Changing Shared Types

Whenever you modify files in `packages/shared-types/src/`, you MUST rebuild:

```bash
npm run types:build
```

Other packages import from `@teranga/shared-types` and depend on the compiled output.

---

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

1. Client authenticates via Firebase Auth SDK (email/password, Google, etc.)
2. Client gets Firebase ID token (JWT) with custom claims (roles, organizationId)
3. Client sends `Authorization: Bearer <idToken>` to API
4. API verifies token via `firebase-admin.auth().verifyIdToken()`
5. API middleware populates `request.user` with uid, email, roles, organizationId

### QR Badge Security

- **v2 format** (current): `registrationId:eventId:userId:epochBase36:hmacSignature` (5 colon-separated parts)
- **v1 format** (legacy, still accepted): `registrationId:eventId:userId:hmacSignature` (4 parts)
- Signed with HMAC-SHA256 using `QR_SECRET` — full 64-char hex digest, no truncation
- Verified with `crypto.timingSafeEqual` (constant-time comparison to prevent timing attacks)
- v2 includes a base36 epoch timestamp for replay detection
- Staff app validates offline against locally cached registration list (synced via Firestore)
- QR signing functions are in `apps/api/src/services/qr-signing.ts` (exported, imported by registration service and tests)

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

## Firebase Emulators

The project is configured for local development with Firebase emulators:

| Service | Port |
|---------|------|
| Auth | 9099 |
| Firestore | 8080 |
| Storage | 9199 |
| Functions | 5001 |
| Hosting | 5000 |
| Pub/Sub | 8085 |
| Emulator UI | 4000 |

Start all: `firebase emulators:start`

---

## Git Branching Strategy

This project follows a **trunk-based development** model with short-lived feature branches.

### Branch Naming Convention

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features and wave implementations | `feature/wave-1-core-loop` |
| `fix/` | Bug fixes | `fix/qr-signature-validation` |
| `refactor/` | Code improvements with no behavior change | `refactor/extract-badge-service` |
| `chore/` | Tooling, CI, dependencies, config | `chore/update-eslint-config` |
| `docs/` | Documentation only | `docs/api-endpoints` |
| `hotfix/` | Urgent production fixes | `hotfix/registration-crash` |

### Workflow Rules

1. **`main` is the stable trunk** — always deployable, protected by CI gate
2. **One branch per wave or logical unit** — e.g., `feature/wave-1-core-loop` for all Wave 1 work
3. **Branch from `main`**, merge back to `main` via PR (or direct merge for solo development)
4. **Commit early, commit often** — small, atomic commits with conventional commit messages
5. **Conventional Commits** format: `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `ci`, `perf`
   - Scope: the affected area — `api`, `web`, `mobile`, `shared-types`, `functions`, `infra`
   - Examples: `feat(api): add badge PDF generation endpoint`, `fix(shared-types): correct registration status enum`
6. **Never force-push to `main`** — rebase or merge, never rewrite shared history
7. **Delete branches after merge** — keep the branch list clean
8. **Tag releases** with semver: `v0.1.0` (Wave 1), `v0.2.0` (Wave 2), etc.

### Wave Development Flow

```
main ──────────────────────────────────────────────►
  └── feature/wave-1-core-loop ──── commits ──── merge back to main
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

| Alias | Firebase Project | Usage |
|-------|-----------------|-------|
| default | `teranga-events-dev` | Local development |
| staging | `teranga-events-staging` | Pre-production testing |
| production | `teranga-events-prod` | Live production |

Switch with: `firebase use <alias>`

---

## Delivery Roadmap

The platform is delivered in **8 waves**, each building on the previous and producing a deployable increment. Full details with task checklists are in `docs/delivery-plan/`.

| Wave | Name | Scope | Est. Effort |
|------|------|-------|-------------|
| Pre-Wave | Foundation Hardening | CI/CD, test gaps, config audit, Firestore rules | 3-4 days |
| Wave 1 | **Core Loop** | Create event → register → generate badge (MVP) | 2 weeks |
| Wave 2 | **Offline QR Check-in** | Staff scanner, offline cache, sync queue (differentiator) | 1.5 weeks |
| Wave 3 | Organizer Productivity | Team mgmt, analytics, event duplication, plan limits | 2 weeks |
| Wave 4 | Social & Sessions | Event feed, messaging, session/agenda builder | 2 weeks |
| Wave 5 | Payments | Wave/Orange Money integration, paid tickets, payouts | 2 weeks |
| Wave 6 | Communications | SMS (Africa's Talking), email, broadcast, notifications | 1.5 weeks |
| Wave 7 | Portals | Speaker self-service, sponsor booths, lead collection | 1.5 weeks |
| Wave 8 | Production Launch | Load testing, security audit, monitoring, app store submission | 2 weeks |

**Tracking:** Each wave file contains a task checklist. Mark tasks `[x]` as they are completed. Update status in `docs/delivery-plan/README.md` as waves progress.

---

## Testing

### Current Test Suite

- **96 tests** across 10 test files (as of 2026-04-05)
- Test runner: **Vitest** with TypeScript
- Run: `cd apps/api && npx vitest run`
- Test files follow `__tests__/` convention next to source files

### Test Categories

| Category | Location | Examples |
|----------|----------|---------|
| QR signing | `src/services/__tests__/qr-signing.test.ts` | v2/v1 sign-verify, tamper detection |
| Event service | `src/services/__tests__/event.service.test.ts` | Create, update, publish, cancel, archive |
| Organization service | `src/services/__tests__/organization.service.test.ts` | Create, members, plan limits |
| Auth middleware | `src/middlewares/__tests__/auth.middleware.test.ts` | Token validation, role defaults |
| Permission middleware | `src/middlewares/__tests__/permission.middleware.test.ts` | RBAC enforcement, super_admin bypass |
| Validation middleware | `src/middlewares/__tests__/validate.middleware.test.ts` | Zod schema validation |
| Event bus | `src/events/__tests__/event-bus.test.ts` | Listener delivery, error isolation |
| Audit listener | `src/events/__tests__/audit.listener.test.ts` | Domain event → audit log mapping |
| Health routes | `src/routes/__tests__/health.routes.test.ts` | Liveness, readiness with Firestore check |
| Event routes | `src/routes/__tests__/events.routes.test.ts` | Auth enforcement, CRUD, response shapes |

### Writing Tests

- Use `vi.mock()` for Firebase dependencies
- Use factories from `src/__tests__/factories.ts` for test data (`buildAuthUser`, `buildOrganizerUser`, `buildSuperAdmin`)
- Service tests should mock repositories; route tests should use `fastify.inject()`
- QR tests import directly from `src/services/qr-signing.ts` — no duplication needed
