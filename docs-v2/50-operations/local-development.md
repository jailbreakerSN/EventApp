# Local Development Guide

> See [Getting Started → Local Setup](../00-getting-started/01-local-setup.md) for the initial setup. This page covers the day-to-day development loop.

---

## Daily workflow

```bash
# 1. Pull latest
git fetch origin develop && git rebase origin/develop

# 2. Start emulators (terminal 1)
firebase emulators:start

# 3. Start API (terminal 2)
npm run api:dev

# 4. Start web back-office (terminal 3)
npm run web:dev

# 5. (Optional) Start participant app (terminal 4)
cd apps/web-participant && npm run dev
```

---

## After pulling a branch

If the branch modifies `packages/shared-types/src/`:

```bash
npm run types:build
```

If the branch modifies `apps/mobile/lib/` providers or Freezed models:

```bash
cd apps/mobile && flutter pub run build_runner build --delete-conflicting-outputs
```

---

## Hot reload

| Service | Hot reload | Notes |
|---|---|---|
| API | ✅ `tsx watch` | Restarts on `.ts` file changes |
| Web back-office | ✅ Next.js Fast Refresh | Instant on component changes |
| Web participant | ✅ Next.js Fast Refresh | Instant on component changes |
| Flutter | ✅ Hot reload / hot restart | `r` in terminal |
| Cloud Functions | ⚠ Manual | Stop emulators, `npm run build` in `apps/functions`, restart |
| Shared types | ⚠ Manual | `npm run types:build` after changes |

---

## Running tests

```bash
# All API tests
cd apps/api && npx vitest run

# Watch mode
cd apps/api && npx vitest

# Specific test file
cd apps/api && npx vitest src/services/__tests__/event.service.test.ts

# Shared types tests
cd packages/shared-types && npx vitest run

# Flutter tests
cd apps/mobile && flutter test
```

---

## Making a database change

1. Modify the Zod schema in `packages/shared-types/src/`
2. `npm run types:build`
3. Update the API service/repository if needed
4. Update the Firestore security rules if new fields need access control (`infrastructure/firebase/firestore.rules`)
5. Update the Firestore indexes if new query patterns are needed (`infrastructure/firebase/firestore.indexes.json`)
6. Update the seed script if the new field should be in test data
7. Update Flutter models manually in `apps/mobile/lib/`

---

## Useful Firestore queries (emulator)

Open http://localhost:4000/firestore and use the filter UI, or query via the API:

```bash
# Check org plan limits
curl http://localhost:3000/v1/organizations/<orgId>/usage \
  -H "Authorization: Bearer $(firebase auth:export --project teranga-app-990a8 | ...)"
```

---

## Testing payment flows locally

Use `method: 'mock'` when initiating a payment — the mock provider auto-succeeds after a 2-second delay:

```bash
curl -X POST http://localhost:3000/v1/payments/initiate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"registrationId": "...", "method": "mock", "returnUrl": "http://localhost:3002/..."}'
```

The mock webhook fires automatically after 2 seconds, updating the payment to `succeeded` and confirming the registration.

---

## Debugging Cloud Functions

```bash
# Watch function invocations in emulator
firebase emulators:start 2>&1 | grep -E "Functions"

# Trigger a Firestore trigger manually by creating a document via the UI
# http://localhost:4000/firestore → New document in `registrations`
```

Functions v2 in the emulator support `console.log()` — logs appear in the terminal running `firebase emulators:start`.
