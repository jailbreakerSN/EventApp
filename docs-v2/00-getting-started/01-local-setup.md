---
title: Local Setup
status: shipped
last_updated: 2026-04-25
---

# Local Setup

> **Status: shipped** — Reflects the working dev environment as of April 2026.

This guide gets every service running locally in ~20 minutes. By the end you will have:

- Firebase emulators running (Auth, Firestore, Storage, Functions, Pub/Sub)
- Fastify API on `:3000`
- Next.js back-office on `:3001`
- Next.js participant app on `:3002`
- Firestore seeded with test data and users for every persona

---

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 22.x | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| npm | 10.x | Bundled with Node 22 |
| Flutter SDK | 3.27+ (stable channel) | [flutter.dev](https://flutter.dev/docs/get-started/install) |
| Firebase CLI | latest | `npm install -g firebase-tools` |
| FlutterFire CLI | latest | `dart pub global activate flutterfire_cli` |
| Java | 11+ | Required by Firebase emulators |

> **WSL2 note:** All servers bind to `0.0.0.0` so the Windows host can reach them. If you access services from the Windows browser, replace `localhost` with your WSL2 IP (`hostname -I | awk '{print $1}'`).

---

## 1. Clone and install

```bash
git clone <repo-url> teranga
cd teranga

# Install all workspace dependencies at once (npm workspaces)
npm install
```

This installs dependencies for all packages: `apps/api`, `apps/functions`, `apps/web-backoffice`, `apps/web-participant`, `packages/shared-types`, `packages/shared-ui`, `packages/shared-config`.

---

## 2. Build shared types

`@teranga/shared-types` is the single source of truth for all Zod schemas and TypeScript types. Other packages import from its compiled output.

```bash
npm run types:build
```

**Always run this after pulling changes to `packages/shared-types/src/`.**

---

## 3. Configure environment files

### API (`apps/api`)

```bash
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` and set:

| Variable | Value for local dev |
|---|---|
| `FIREBASE_PROJECT_ID` | `teranga-app-990a8` (or your dev project) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Path to a service account JSON file, OR leave empty to use emulator auto-auth |
| `QR_SECRET` | Any random string ≥ 16 chars (e.g. `openssl rand -hex 32`) |
| `QR_MASTER_SECRET` | Any random string ≥ 32 chars (used for HKDF key derivation) |
| `CORS_ORIGINS` | `http://localhost:3001,http://localhost:3002` |
| `USE_EMULATOR` | `true` |

Leave all third-party keys (`RESEND_API_KEY`, `AT_API_KEY`, etc.) empty for local dev — the API uses mock providers when keys are absent.

See [99-reference/env-variables.md](../99-reference/env-variables.md) for the full variable list.

### Web back-office (`apps/web-backoffice`)

```bash
cp apps/web-backoffice/.env.example apps/web-backoffice/.env.local
```

Fill in your Firebase web SDK config (from the Firebase console → Project settings → Your apps → Web app config):

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=teranga-app-990a8
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Web participant app (`apps/web-participant`)

```bash
cp apps/web-participant/.env.example apps/web-participant/.env.local
```

Same Firebase web SDK config as the back-office, plus:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## 4. Start Firebase emulators

```bash
firebase emulators:start
```

The emulators expose the following ports:

| Service | Port | UI |
|---|---|---|
| Firebase Auth | 9099 | |
| Firestore | 8080 | |
| Cloud Storage | 9199 | |
| Cloud Functions | 5001 | |
| Pub/Sub | 8085 | |
| Emulator UI | 4000 | http://localhost:4000 |

Leave this terminal open. The emulators must be running before you seed data or start other services.

---

## 5. Seed test data

```bash
npx tsx scripts/seed-emulators.ts
```

This script is **idempotent** — re-running it is safe. It creates:

| Email | Password | Persona |
|---|---|---|
| `admin@teranga.dev` | `teranga2026!` | Organizer (Pro plan) |
| `organizer@teranga.dev` | `teranga2026!` | Organizer (Starter plan) |
| `free@teranga.dev` | `teranga2026!` | Organizer (Free plan) |
| `enterprise@teranga.dev` | `teranga2026!` | Organizer (Enterprise plan) |
| `participant@teranga.dev` | `teranga2026!` | Participant |
| `staff@teranga.dev` | `teranga2026!` | Staff scanner |
| `speaker@teranga.dev` | `teranga2026!` | Speaker |
| `sponsor@teranga.dev` | `teranga2026!` | Sponsor |
| `super@teranga.dev` | `teranga2026!` | Super-admin |

It also seeds 4 organizations, 4 events (1 published paid, 1 published free, 1 draft, 1 cancelled), 6 registrations, 2 badges, and more. See [50-operations/seeding.md](../50-operations/seeding.md) for the full entity inventory.

---

## 6. Start all services

Open separate terminals (or use a process manager like `tmux`):

```bash
# Terminal 1 — Fastify API
npm run api:dev
# Starts on http://localhost:3000
# Swagger UI: http://localhost:3000/documentation

# Terminal 2 — Web back-office
npm run web:dev
# Starts on http://localhost:3001
# Login with admin@teranga.dev / teranga2026!

# Terminal 3 — Web participant app  
cd apps/web-participant && npm run dev
# Starts on http://localhost:3002
```

---

## 7. Flutter mobile app (optional)

```bash
# Generate FirebaseOptions for local emulators
cd apps/mobile && flutterfire configure --project=teranga-app-990a8

# Run on connected device or emulator
flutter run
```

The mobile app connects to the emulators when `USE_EMULATOR=true` is set in the Flutter `--dart-define` flags or `lib/core/config.dart`.

---

## Verifying your setup

1. Open http://localhost:4000 — you should see the Emulator UI with Firestore data
2. Open http://localhost:3000/health — should return `{"status":"ok"}`
3. Open http://localhost:3001/login — sign in with `admin@teranga.dev`
4. Open http://localhost:3002 — you should see the event discovery page

---

## Common problems

| Symptom | Fix |
|---|---|
| `Cannot find module '@teranga/shared-types'` | Run `npm run types:build` |
| Firestore reads return empty | Emulators not running, or UI port differs — check `firebase.json` |
| Auth sign-in fails locally | Make sure `USE_EMULATOR=true` in `.env` so the API points to Auth emulator port 9099 |
| Flutter build_runner errors | Run `flutter pub run build_runner build --delete-conflicting-outputs` in `apps/mobile` |
| Custom claims not applied | Sign out and back in (or force-refresh token) after the seed script sets roles |
| WSL2: can't reach service from Windows | Use `hostname -I` to find the WSL2 IP and replace `localhost` |
