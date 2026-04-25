# `@teranga/api`

Teranga REST API — **Fastify on Cloud Run**, the platform's primary backend. ~200 routes covering events, registrations, badges, check-ins, organizations, subscriptions, payments, notifications, and admin.

> **Canonical reference:** [`docs-v2/30-api/`](../../docs-v2/30-api/) — feature-by-feature route documentation, plus the OpenAPI 3.0.3 artefact at [`docs-v2/30-api/openapi/`](../../docs-v2/30-api/openapi/).

## Tech

- **Fastify 5** + TypeScript, layered routes/services/repositories.
- **Firebase Admin SDK** for Firestore, Auth, and Storage.
- **Zod** for request/response validation (schemas live in `@teranga/shared-types`).
- **Pino** structured logger + AsyncLocalStorage request context.
- **Resend** for transactional email; **FCM** for push.
- Always-on Swagger (`/v1/admin/openapi.json`); interactive UI at `/docs` (non-production only).

## Architecture in one diagram

See [`docs-v2/20-architecture/overview.md`](../../docs-v2/20-architecture/overview.md). Layered:

```
Routes (thin controllers) → Services (business logic) → Repositories (Firestore)
       ↓                          ↓                              ↑
  Middleware chain          Domain Event Bus ── Listeners (audit, notifications)
  (auth, validate,
   permissions)
```

ADRs live at [`docs-v2/20-architecture/decisions/`](../../docs-v2/20-architecture/decisions/) — start with [0007 Fastify layered architecture](../../docs-v2/20-architecture/decisions/0007-fastify-layered-architecture.md), [0010 Domain event bus](../../docs-v2/20-architecture/decisions/0010-domain-event-bus.md), and [0014 Graceful shutdown](../../docs-v2/20-architecture/decisions/0014-graceful-shutdown-process-error-handling.md).

## Local dev

From the repo root:

```bash
# 1. Set up env (one-time)
cp apps/api/.env.example apps/api/.env

# 2. Build shared-types (required first)
npm run types:build

# 3. Start Firebase emulators (Firestore, Auth, Storage)
firebase emulators:start

# 4. In another terminal: start the API on :3000
npm run api:dev
```

Open [http://localhost:3000/docs](http://localhost:3000/docs) for the interactive Swagger UI (non-production builds only).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Hot-reload via `tsx watch`, reads `.env` |
| `npm run build` | TypeScript compile + path-alias rewrite |
| `npm run start` | Production start from `dist/` |
| `npm run test` | Vitest unit + integration tests |
| `npm run test:integration` | Emulator-driven tests (boot Firestore + Auth) |
| `npm run lint` | ESLint over `src/` |
| `npm run type-check` | `tsc --noEmit` |
| `npm run docs:openapi` | _(from repo root)_ regenerate `docs-v2/30-api/openapi/openapi.{json,yaml}` |

## Test discipline

- **1598+ tests** across services, routes, listeners, middlewares, observability.
- See [`docs-v2/60-contributing/testing.md`](../../docs-v2/60-contributing/testing.md) and `.claude/skills/teranga-testing/SKILL.md` for the four-cases-per-method contract.

## Deployment

Cloud Run, region `europe-west1`. Image: `gcr.io/teranga-events-prod/api`. See [`docs-v2/50-operations/ci-cd.md`](../../docs-v2/50-operations/ci-cd.md).
