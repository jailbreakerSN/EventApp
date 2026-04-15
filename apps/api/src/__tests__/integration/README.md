# API Integration Tests

Emulator-driven tests that exercise the real service → Firestore path,
with **no mocks**. They catch classes of bugs that the mocked unit
suite structurally can't — read-after-write ordering in transactions,
counter arithmetic under contention, denormalisation drift, cross-
tenant leaks, and undefined-field writes to the Admin SDK.

## Running locally

Prerequisites: Node 22, Java 17+ (for the Firestore emulator), and
the repo's normal `npm ci`.

```bash
# One-shot — boots Firestore + Auth emulators and tears them down on exit.
npx firebase-tools@13 emulators:exec --only firestore,auth \
  --project teranga-integration-test \
  "npm run test:integration --workspace=apps/api"

# Or, with already-running emulators (`firebase emulators:start`):
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_PROJECT_ID=teranga-integration-test \
  npm run test:integration --workspace=apps/api
```

CI runs the same command in the `api-integration-test` job.

## Conventions

| Convention                                                                              | Why                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| One `beforeEach` per file calls `clearFirestore()` then re-seeds the fixtures it needs. | Tests must be independent. The emulator REST `DELETE` is O(1) regardless of collection size.                                                |
| Fixtures are written **directly** via the admin SDK (see `helpers.ts`).                 | Seeding via the real service would couple test setup to the code under test — a logic bug in registration would poison every check-in test. |
| Assertions read back from Firestore with the typed `read*` helpers.                     | Proves the write actually persisted, not just that the service method returned.                                                             |
| Every test uses `seedSystemPlans()` when it touches orgs or subscriptions.              | The real code paths resolve effective limits via the catalog; an empty catalog triggers fallback paths that obscure real behaviour.         |
| The default vitest config **excludes** this folder.                                     | Contributors without an emulator can still run `npm test` fast. The split is deliberate.                                                    |
| Run sequentially (`fileParallelism: false`).                                            | Tests share the emulator's Firestore project; parallel runs would clobber each other.                                                       |

## Adding a new scenario

1. Pick a feature whose transactional / cross-tenant behaviour is
   load-bearing (registration, check-in, invites, payments, etc.).
2. Create `src/__tests__/integration/<feature>-flow.test.ts`.
3. In `beforeEach`, `clearFirestore()` + `seedSystemPlans()` + any
   helpers you need. If a helper is missing, add it to `helpers.ts`
   — keep signatures narrow and Firestore-typed.
4. Invoke the real service (no mocks, no `vi.spyOn`).
5. Assert on both the service return value AND the Firestore state
   (via `readOrg`, `readEvent`, `readSubscription`, …).
6. Add the scenario to the PR description so reviewers know what's
   covered.

## Current coverage

| File                            | Scenarios                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan-catalog.test.ts`          | Plan CRUD, isSystem protection, public-catalog filtering                                                                                                                                              |
| `assign-plan.test.ts`           | Phase 5 admin `assignPlan` + per-dimension overrides + scheduledChange clearing                                                                                                                       |
| `event-limit.test.ts`           | Phase 3 enforcement: `maxEvents` respects the denormalised snapshot, override raises the ceiling                                                                                                      |
| `scheduled-rollover.test.ts`    | Phase 4c rollover with fake clock; idempotency; `revertScheduledChange`                                                                                                                               |
| `registration-flow.test.ts`     | Register / cancel counter consistency, duplicate detection, `maxParticipantsPerEvent` enforcement, draft-event gate                                                                                   |
| `checkin-flow.test.ts`          | QR verify, duplicate-scan idempotency, tampered payload rejection, cross-event replay defence, mixed-batch processing                                                                                 |
| `cross-tenant-security.test.ts` | Organizer / staff org isolation on `event.update/cancel/publish` + `checkin.bulkSync`; super_admin bypass; participant can't cancel others' registrations                                             |
| `invite-member-limit.test.ts`   | `createInvite` respects `maxMembers` (members + pending); admin override unblocks; duplicate email → ConflictError                                                                                    |
| `invite-accept-flow.test.ts`    | End-to-end `acceptInvite`: invitee appended to `memberIds` transactionally AND `organizationId` written into Firebase Auth custom claims; email mismatch, expired invite, mid-flight maxMembers clamp |
| `admin-user-management.test.ts` | Super admin `updateUserRoles` / `updateUserStatus` syncs both Firestore AND Firebase Auth (claims / `disabled` flag); self-demotion + self-suspension blocked; non-admin forbidden                    |

## Non-goals

- **No route-level tests.** Those live in `src/routes/__tests__/` and
  use `fastify.inject()`. Integration tests drive the service layer
  directly so permission / transaction logic is verified without the
  HTTP plumbing.
- **No payment-provider mocks.** When we integrate Wave / Orange Money
  properly, add a parallel `integration-payments/` folder against a
  provider-sandbox endpoint, not against the emulator.
