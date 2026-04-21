# Teranga — African Event Management Platform

> **L'Événementiel Africain, Connecté et Mémorable**

Teranga is a multi-tenant SaaS platform for creating, publishing, and managing events in Senegal and francophone West Africa. The name is the Wolof word for *hospitality* — the cultural foundation of every event.

**Core differentiator:** Offline-first QR badge check-in that works reliably at venues with intermittent connectivity, with ECDH-encrypted sync and HKDF per-event key derivation.

---

## Platform at a glance

| Surface | Audience | Stack |
|---|---|---|
| **Web back-office** | Organizers, admins | Next.js 15 · React 19 · TailwindCSS · PWA |
| **Web participant app** | Participants (public + auth) | Next.js 15 · SSR/SSG for SEO |
| **Mobile app** | Participants, staff scanners | Flutter 3 · Riverpod 2 · Hive · go_router |
| **REST API** | All clients | Fastify 4 · TypeScript · Cloud Run |
| **Background jobs** | Triggers, notifications | Firebase Cloud Functions v2 |

**Payments:** Wave · Orange Money (live) · PayDunya / Stripe (stub)  
**Notifications:** FCM push · Africa's Talking SMS · Resend email  
**Database:** Cloud Firestore · Firebase Auth · Cloud Storage  
**Localization:** French (primary) · English · Wolof (in progress) · XOF / Africa/Dakar

---

## Monorepo structure

```
teranga/
├── apps/
│   ├── api/                  # Fastify REST API → Cloud Run
│   ├── functions/            # Firebase Cloud Functions v2 (triggers only)
│   ├── web-backoffice/       # Next.js 15 PWA — organizers + admin
│   ├── web-participant/      # Next.js 15 SSR/SSG — participant discovery & registration
│   └── mobile/               # Flutter — iOS + Android
├── packages/
│   ├── shared-types/         # Zod schemas + TypeScript types (single source of truth)
│   ├── shared-ui/            # Shared React components
│   └── shared-config/        # Tailwind preset, ESLint config
├── infrastructure/
│   ├── firebase/             # Firestore rules, storage rules, composite indexes
│   └── terraform/            # GCP IaC (planned)
├── scripts/                  # Seed, reset, and audit utilities
├── docs-v2/                  # Full documentation (canonical)
└── docs/                     # Legacy artefacts (archived)
```

Managed with **npm workspaces** + **Turborepo**. Node ≥ 20, npm ≥ 10 required.

---

## Quick start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 10 | bundled with Node |
| Flutter | ≥ 3.27 (stable) | [flutter.dev](https://flutter.dev) |
| Firebase CLI | latest | `npm i -g firebase-tools` |
| Java | ≥ 11 | required by Firestore emulator |

### 1 — Install dependencies

```bash
git clone https://github.com/jailbreakerSN/EventApp.git
cd EventApp
npm install
npm run types:build        # compile shared-types first — required by all other packages
```

### 2 — Configure environment

```bash
cp apps/api/.env.example              apps/api/.env
cp apps/web-backoffice/.env.example   apps/web-backoffice/.env.local
cp apps/web-participant/.env.example  apps/web-participant/.env.local
```

Edit each file. At minimum, set `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, and `QR_SECRET` in `apps/api/.env`. See [`docs-v2/99-reference/env-variables.md`](docs-v2/99-reference/env-variables.md) for the full reference.

### 3 — Start emulators and services

```bash
# Terminal 1 — Firebase emulators (Firestore, Auth, Storage, Functions, Pub/Sub)
firebase emulators:start

# Terminal 2 — REST API (http://localhost:3000)
npm run api:dev

# Terminal 3 — Web back-office (http://localhost:3001)
npm run web:dev

# Terminal 4 — Web participant app (http://localhost:3002)
npm run participant:dev

# Mobile (separate terminal)
cd apps/mobile && flutter run
```

### 4 — Seed test data

```bash
npm run seed          # creates 10 users, 4 orgs (free/starter/pro/enterprise), sample events
```

Seed users: `admin@teranga.dev` / `organizer@teranga.dev` / `free@teranga.dev` / `enterprise@teranga.dev` — all passwords are `Password123!`.

---

## Development commands

| Command | Description |
|---|---|
| `npm run api:dev` | Fastify API with hot reload |
| `npm run web:dev` | Web back-office (Next.js) |
| `npm run participant:dev` | Participant web app (Next.js) |
| `npm run types:build` | Rebuild shared-types after schema changes |
| `npm run build` | Build all packages via Turborepo |
| `npm run lint` | ESLint across all TypeScript packages |
| `npm run format` | Prettier across all files |
| `npm run type-check` | TypeScript strict check across all packages |
| `npm run test` | Run all test suites via Turborepo |
| `npm run seed` | Seed Firebase emulators with test data |
| `npm run seed:reset` | Wipe and re-seed emulators |

> **After modifying anything in `packages/shared-types/src/`**, always run `npm run types:build` before starting other services.

---

## Testing

```bash
# All tests
npm run test

# API only (fastest — ~4 s)
cd apps/api && npx vitest run

# Shared-types contract/snapshot tests
cd packages/shared-types && npx vitest run

# Flutter
cd apps/mobile && flutter test
```

The CI gate runs: shared-types → API lint + type-check + tests + Firestore emulator integration → Functions → Web back-office lint + type-check + build → dependency audit.

---

## Architecture

```
                    ┌─────────────────┐
                    │  Firebase Auth  │
                    └────────┬────────┘
                             │ ID token (JWT + custom claims)
          ┌──────────────────┼──────────────────────┐
          │                  │                       │
   Web back-office    Web participant         Flutter app
   (Next.js 15)       (Next.js 15)            (Flutter 3)
          │                  │                       │
          └──────────────────┼──────────────────────┘
                             │ REST  /v1/...
                    ┌────────▼────────┐
                    │  Fastify API    │  Cloud Run
                    │  (Cloud Run)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        Firestore         Firebase       Cloud Storage
                          Functions        (badges, images)
                        (triggers only)
```

**API layers:** Routes (thin controllers) → Services (business logic + domain events) → Repositories (Firestore CRUD) → Firestore

**Security:** Deny-all Firestore rules as defense-in-depth. Multi-tenancy enforced at service layer with `requireOrganizationAccess()` on every data access. RBAC via 8 roles and 99 `resource:action` permission strings.

**QR badges:** HKDF-SHA256 per-event key derivation, HMAC-SHA256 signing, `notBefore`/`notAfter` validity window with ±2 h clock-skew grace. Offline sync uses ECDH-X25519 + AES-256-GCM (forward secrecy).

Full architecture documentation: [`docs-v2/20-architecture/`](docs-v2/20-architecture/)

---

## Freemium plans

| | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| Price | — | 9 900 XOF/mo | 29 900 XOF/mo | Custom |
| Events | 3 | 10 | Unlimited | Unlimited |
| Participants/event | 50 | 200 | 2 000 | Unlimited |
| Team members | 1 | 3 | 50 | Unlimited |
| QR scanning | — | ✅ | ✅ | ✅ |
| Paid tickets | — | — | ✅ | ✅ |
| API access | — | — | — | ✅ |
| White-label | — | — | — | ✅ |

---

## Deployment

### API — Cloud Run

```bash
docker build -f apps/api/Dockerfile -t gcr.io/teranga-events-prod/api .
docker push gcr.io/teranga-events-prod/api
gcloud run deploy teranga-api \
  --image gcr.io/teranga-events-prod/api \
  --region europe-west1 \
  --allow-unauthenticated
```

### Cloud Functions

```bash
firebase deploy --only functions
```

### Web apps — Firebase Hosting

```bash
npm run build --workspace=apps/web-backoffice
firebase deploy --only hosting
```

Staging deploys are automated via `.github/workflows/deploy-staging.yml` on every push to `develop`.

---

## Contributing

We follow **trunk-based development** with short-lived feature branches off `develop`.

```bash
git checkout -b feature/my-feature develop
# ... make changes ...
git push -u origin feature/my-feature
# open PR → develop
```

**Commit format:** `type(scope): description` — e.g. `feat(api): add refund endpoint`  
Types: `feat` `fix` `refactor` `test` `chore` `docs` `ci` `perf`  
Scopes: `api` `web` `mobile` `shared-types` `functions` `infra` `platform`

Before pushing service-layer changes, run the project subagents:

```
@security-reviewer          # org isolation, permissions, input validation
@firestore-transaction-auditor  # read-then-write without transaction
@domain-event-auditor       # mutations missing eventBus.emit()
@plan-limit-auditor         # freemium gates on new features
@l10n-auditor               # hardcoded strings in UI
```

Full contributing guide: [`docs-v2/60-contributing/`](docs-v2/60-contributing/)

---

## Documentation

| What you need | Where |
|---|---|
| Get the project running | [`docs-v2/00-getting-started/01-local-setup.md`](docs-v2/00-getting-started/01-local-setup.md) |
| Understand the data model | [`docs-v2/20-architecture/reference/data-model.md`](docs-v2/20-architecture/reference/data-model.md) |
| Add a new API endpoint | [`docs-v2/60-contributing/cookbooks/adding-a-route.md`](docs-v2/60-contributing/cookbooks/adding-a-route.md) |
| API endpoint reference | [`docs-v2/30-api/`](docs-v2/30-api/) |
| All environment variables | [`docs-v2/99-reference/env-variables.md`](docs-v2/99-reference/env-variables.md) |
| Freemium enforcement | [`docs-v2/20-architecture/concepts/freemium-enforcement.md`](docs-v2/20-architecture/concepts/freemium-enforcement.md) |
| QR badge security | [`docs-v2/20-architecture/concepts/qr-v4-and-offline-sync.md`](docs-v2/20-architecture/concepts/qr-v4-and-offline-sync.md) |
| Roadmap | [`docs-v2/10-product/roadmap.md`](docs-v2/10-product/roadmap.md) |

Full documentation index: [`docs-v2/README.md`](docs-v2/README.md)

---

## Environment overview

| Alias | Firebase project | Usage |
|---|---|---|
| `default` / `staging` | `teranga-app-990a8` | Local dev + staging |
| `production` | `teranga-events-prod` | Live (not yet deployed) |

Switch with: `firebase use <alias>`

Firebase emulator ports: Auth `9099` · Firestore `8080` · Storage `9199` · Functions `5001` · Pub/Sub `8085` · UI `4000`

---

## License

Private — all rights reserved. © 2026 Teranga Events SRL.
