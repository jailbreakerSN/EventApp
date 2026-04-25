---
title: System Architecture Overview
status: shipped
last_updated: 2026-04-25
---

# System Architecture Overview

> **Status: shipped** — Reflects the implemented system as of April 2026.

---

## C4 Level 1 — System Context

```
                         ┌─────────────────────────────────────────────────────┐
                         │                    TERANGA PLATFORM                   │
                         │                                                       │
  ┌──────────┐           │   ┌─────────────┐   ┌─────────────────────────────┐  │
  │Organizer │──────────►│   │ Web          │   │ Fastify API (Cloud Run)     │  │
  │          │           │   │ Back-office  │──►│ apps/api                    │  │
  └──────────┘           │   │ (Next.js 15) │   └──────────────┬──────────────┘  │
                         │   └─────────────┘                  │                 │
  ┌──────────┐           │   ┌─────────────┐                  │                 │
  │Participant│──────────►│   │ Web          │                  │                 │
  │          │           │   │ Participant  │──►               │                 │
  └──────────┘           │   │ (Next.js 15) │   ┌─────────────▼──────────────┐  │
                         │   └─────────────┘   │ Firebase Platform           │  │
  ┌──────────┐           │   ┌─────────────┐   │  • Firestore (database)     │  │
  │  Staff   │──────────►│   │ Mobile App  │──►│  • Auth (identity)          │  │
  │          │           │   │ (Flutter 3) │   │  • Functions v2 (triggers)  │  │
  └──────────┘           │   └─────────────┘   │  • Storage (files, PDFs)    │  │
                         │                      │  • FCM (push)               │  │
  ┌──────────┐           │                      └─────────────────────────────┘  │
  │Super     │──────────►│                                                       │
  │Admin     │           └─────────────────────────────────────────────────────┘│
  └──────────┘                                                                    
                                        External services:
                                        • Wave (mobile money)
                                        • Orange Money
                                        • Resend (email)
                                        • Africa's Talking (SMS)
                                        • Sentry (error tracking)
```

---

## C4 Level 2 — Container View

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Teranga Platform                                                               │
│                                                                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │  web-backoffice  │  │  web-participant  │  │  mobile (Flutter)          │  │
│  │  Next.js 15      │  │  Next.js 15       │  │  iOS + Android             │  │
│  │  :3001           │  │  :3002            │  │                            │  │
│  │  Organizer PWA   │  │  SSR/SSG public   │  │  Participants + Staff      │  │
│  └────────┬─────────┘  └────────┬──────────┘  └────────────┬───────────────┘  │
│           │                     │                          │                  │
│           └─────────────────────┴──────────────────────────┘                  │
│                                         │ REST /v1/*                           │
│                                         ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  apps/api — Fastify REST API (Cloud Run, Node 22)                        │  │
│  │                                                                          │  │
│  │  Routes → Middlewares → Services → Repositories → Firestore             │  │
│  │              ↓               ↓                                          │  │
│  │         authenticate    Domain Event Bus → Listeners                    │  │
│  │         validate              (audit, notify, plan denorm)              │  │
│  │         requirePermission                                                │  │
│  └────────────────────────────────┬────────────────────────────────────────┘  │
│                                   │                                           │
│  ┌────────────────────────────────▼────────────────────────────────────────┐  │
│  │  Firebase Platform                                                       │  │
│  │                                                                          │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐  │  │
│  │  │  Firestore  │ │  Auth        │ │  Functions v2│ │  Cloud Storage │  │  │
│  │  │  (primary   │ │  (Firebase   │ │  (triggers   │ │  (badge PDFs,  │  │  │
│  │  │   database) │ │   Auth +     │ │   only, not  │ │   event images,│  │  │
│  │  │             │ │   custom     │ │   HTTP)      │ │   profile      │  │  │
│  │  │             │ │   claims)    │ │              │ │   photos)      │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────┘ └────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  packages/                                                               │  │
│  │  shared-types  — Zod schemas (single source of truth)                   │  │
│  │  shared-ui     — React components (used by both Next.js apps)           │  │
│  │  shared-config — Tailwind preset, ESLint config                         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Key design decisions (brief; full ADRs in `decisions/`)

| Decision | Rationale |
|---|---|
| API on Cloud Run, not Cloud Functions for HTTP | Cloud Functions have cold starts and per-request overhead. Cloud Run is always-warm and better for a REST API. |
| Cloud Functions only for triggers | Auth events, Firestore document changes, Cloud Scheduler, Pub/Sub. Never HTTPS. |
| Zod schemas as single source of truth | `@teranga/shared-types` defines all data shapes. API validates with Zod; web imports the same types. Flutter mirrors manually. |
| Deny-all Firestore security rules | Top-level `allow read, write: if false`. Every collection must have explicit rules. Defense-in-depth alongside API validation. |
| HMAC-SHA256 QR signing (v4) | Per-event HKDF-derived keys prevent cross-event replay. `timingSafeEqual` prevents timing attacks. |
| Domain event bus | Services emit events for side effects. Listeners handle audit, notifications, plan denormalization. Decoupled — services never call other services for side effects. |
| AsyncLocalStorage request context | Carries `requestId`, `userId`, `organizationId` through async chains without parameter threading. |

---

## API layer breakdown

```
apps/api/src/
├── routes/          # Thin HTTP controllers — validate input, call service, return response
├── services/        # All business logic — permission checks, plan limits, domain events
├── repositories/    # Firestore CRUD — generic BaseRepository<T> + transaction helper
├── middlewares/     # authenticate, validate({ body, params, query }), requirePermission
├── events/          # Domain event bus + listeners (audit, notification, plan-denorm)
├── errors/          # Typed errors: NotFoundError, ForbiddenError, PlanLimitError, etc.
├── context/         # AsyncLocalStorage request context
└── config/          # Firebase admin init, COLLECTIONS constant, env config
```

### Request lifecycle

```
HTTP request
  → Fastify routing
    → authenticate middleware (verifies Firebase JWT, populates request.user)
    → validate middleware (Zod schema validation)
    → requirePermission middleware (RBAC check)
    → Route handler
      → Service method
        → requireOrganizationAccess() — org isolation
        → checkPlanLimit() / requirePlanFeature() — freemium gate
        → Repository call (Firestore read/write, wrapped in transaction if needed)
        → eventBus.emit('domain.event') — fire-and-forget side effects
      → Format response
    → Fastify error handler (catches AppError subclasses → JSON response)
```

---

## Infrastructure

| Resource | Provider | Region |
|---|---|---|
| API (REST) | Cloud Run | europe-west1 |
| Cloud Functions (triggers) | Firebase Functions v2 | europe-west1 |
| Database | Cloud Firestore | europe-west1 |
| Auth | Firebase Authentication | global |
| File storage | Cloud Storage for Firebase | europe-west1 |
| Push notifications | Firebase Cloud Messaging | global |
| Error tracking | Sentry | cloud |
| Email | Resend | cloud |
| SMS | Africa's Talking | cloud |
| Monorepo build | Turborepo (npm workspaces) | local / CI |
| CI/CD | GitHub Actions | cloud |

---

## Further reading

- [Multi-tenancy & org isolation](./concepts/multi-tenancy.md)
- [QR v4 & offline sync encryption](./concepts/qr-v4-and-offline-sync.md)
- [Freemium enforcement](./concepts/freemium-enforcement.md)
- [Domain events & audit trail](./concepts/domain-events.md)
- [Data model](./reference/data-model.md)
- [ADR index](./decisions/README.md)
