---
title: Firebase Emulators
status: shipped
last_updated: 2026-04-25
---

# Firebase Emulators

> **Status: shipped** — All services run locally via Firebase Emulator Suite.

---

## Starting emulators

```bash
firebase emulators:start
```

From the repo root. Requires the Firebase CLI (`npm install -g firebase-tools`) and Java 11+.

### Ports

| Service | Port | Notes |
|---|---|---|
| Auth | 9099 | Firebase Auth emulator |
| Firestore | 8080 | Firestore emulator |
| Cloud Storage | 9199 | Storage emulator |
| Cloud Functions | 5001 | Functions v2 emulator |
| Pub/Sub | 8085 | Pub/Sub emulator |
| Emulator UI | 4000 | http://localhost:4000 |

All services bind to `0.0.0.0` for WSL2 compatibility.

---

## Emulator UI

Open http://localhost:4000 to access:
- **Firestore** — browse/edit documents in real time
- **Auth** — view users, test auth flows
- **Functions** — trigger functions manually, view logs
- **Storage** — browse uploaded files

---

## Connecting services to emulators

The API connects to emulators when `USE_EMULATOR=true` in `apps/api/.env`:

```typescript
// apps/api/src/config/firebase.ts
if (process.env.USE_EMULATOR === 'true') {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
}
```

The web apps connect when the Firebase client SDK detects `NEXT_PUBLIC_USE_EMULATOR=true` (or when running against `localhost`).

---

## Data persistence

By default, emulator data is **not persisted** between restarts. To persist:

```bash
firebase emulators:start --import=./emulator-data --export-on-exit
```

Or export manually:

```bash
firebase emulators:export ./emulator-data
```

---

## Functions in emulators

Cloud Functions v2 triggers are emulated locally. Firestore document triggers fire automatically when you create/update documents via the UI or API.

Watch function logs:
```bash
firebase emulators:start 2>&1 | grep -E "(functions|⚡)"
```

---

## Common issues

| Problem | Fix |
|---|---|
| Emulators fail to start | Check if ports 8080, 9099, 5001, etc. are already in use (`lsof -i :8080`) |
| Firestore data seems stale | Clear IndexedDB in browser dev tools (Application → IndexedDB → delete) |
| Functions not triggering | Ensure `firebase.json` has correct function source path; rebuild with `cd apps/functions && npm run build` |
| Auth emulator 401 errors | Make sure API has `FIREBASE_AUTH_EMULATOR_HOST` set and `USE_EMULATOR=true` |
| WSL2: Can't reach emulator from Windows | Use WSL IP (`hostname -I`) instead of `localhost` in browser |
