---
name: teranga-testing
description: Use this skill whenever Claude is authoring, modifying, or reviewing tests in the Teranga monorepo (`apps/api/src/**/__tests__/`, `apps/web-backoffice/src/**/__tests__/`, `apps/web-participant/src/**/__tests__/`, `packages/shared-types/src/__tests__/`). It encodes the project's mock conventions (Firestore tx + eventBus + AuthUser factories), the four mandatory test cases per service method, the snapshot-test policy, and the templates for service / route / listener / hook tests. Auto-trigger on any test file edit; mention explicitly if writing a new test from scratch.
---

# Teranga — Test Authoring Skill

This skill encodes how Teranga writes tests so they stay deterministic, fast, and aligned with the security + transaction rules in `CLAUDE.md`. The platform ships **1 598+ Vitest tests** across services, routes, listeners, hooks, and contract snapshots — every new test follows the patterns below.

If a pattern below doesn't fit a new edge case, fork the closest existing test file (don't invent a new mock shape from scratch). Drift in mock shapes is the #1 source of CI flakes.

## Stack

| Surface | Runner | Convention |
|---|---|---|
| `apps/api` | **Vitest** (`vitest.config.ts` at the workspace root) | Run with `cd apps/api && npx vitest run`. Test files live in `__tests__/` next to source. Naming: `{filename}.test.ts`. |
| `apps/web-backoffice`, `apps/web-participant` | **Vitest** + `@testing-library/react` | Same `__tests__/` convention. `.test.tsx` for component tests, `.test.ts` for hooks/utils. |
| `packages/shared-types` | **Vitest** + Zod contract snapshots | One snapshot file per schema bundle. Snapshots are pinned — adding a field is a visible diff. |

## The Four Mandatory Cases per Service Method

Every new service method **must** ship with at least these four test cases. The factories make them cheap to write (~10 LOC each).

```ts
describe("ServiceName.methodName", () => {
  it("happy path — the canonical success scenario", async () => { /* … */ });
  it("rejects callers without the required permission", async () => { /* … */ });
  it("rejects cross-organisation access", async () => { /* … */ });
  it("propagates a clean error when Firestore fails", async () => { /* … */ });
});
```

Skip the org-access case **only** when the method is platform-wide by design (admin endpoints) — and document the omission in a comment.

## Canonical Mock Patterns (5 patterns, copy-paste)

### 1. Firestore transaction mock (services that read-then-write)

```ts
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockTxSet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, update: mockTxUpdate, set: mockTxSet };
      return fn(tx);
    }),
    collection: vi.fn(/* see test file for the doc()/where() chain */),
  },
  COLLECTIONS: { /* … only the keys this service touches … */ },
}));

// In the test:
mockTxGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: "archived" }) });
await service.restore("evt-1", user);
expect(mockTxUpdate).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({ status: "draft" }),
);
```

**Reset between tests:** add `mockTxGet.mockReset()` (etc.) to `beforeEach`. `clearAllMocks()` only wipes call history — `mockReset()` also drops `mockResolvedValueOnce` queues, which is what causes the most insidious leak ("test 2 sees test 1's queued value").

### 2. eventBus emit mock (services that emit domain events)

```ts
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));
import { eventBus } from "@/events/event-bus";

// In the test:
expect(eventBus.emit).toHaveBeenCalledWith(
  "event.restored",
  expect.objectContaining({
    eventId: "evt-1",
    organizationId: "org-1",
    actorId: user.uid,
  }),
);
```

Always assert the **exact event name** + `actorId` + the resource id. Don't loosen with `expect.anything()` — drift in event payloads is a real cause of audit-trail bugs.

### 3. Request context mock (services that read `getRequestContext`)

```ts
vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
  getActorId: () => "test-uid",
  getRequestContext: () => ({
    requestId: "test-request-id",
    userId: "test-uid",
    organizationId: "test-org",
    startTime: Date.now(),
  }),
  trackFirestoreReads: vi.fn(),
}));
```

Sprint-3 T4.2 added `trackFirestoreReads` — services that don't import it can skip that key, but the BaseRepository tests need it.

### 4. AuthUser + entity factories

`apps/api/src/__tests__/factories.ts` exports the canonical factories. **Always use them** — never hand-roll an AuthUser inline (you'll forget a field and fail typecheck on the next AuthUser shape change).

```ts
import {
  buildAuthUser,        // generic, opts via Partial<AuthUser>
  buildOrganizerUser,   // organizer for a specific orgId
  buildSuperAdmin,      // super_admin global
  buildEvent,           // valid Event with sane defaults
  buildOrganization,    // valid Organization
} from "@/__tests__/factories";

const admin = buildSuperAdmin();
const support = buildAuthUser({ uid: "u-1", roles: ["platform:support"] });
const event = buildEvent({ organizationId: "org-1", status: "published" });
```

### 5. Fastify route inject (route-level integration tests)

```ts
import Fastify from "fastify";
import { buildApp } from "@/app";

const app = await buildApp();

const res = await app.inject({
  method: "POST",
  url: "/v1/events/evt-1/restore",
  headers: { Authorization: "Bearer test-token" }, // mockVerifyIdToken below
  payload: {},
});
expect(res.statusCode).toBe(200);
expect(JSON.parse(res.body)).toMatchObject({ success: true });
```

Token verification is mocked at the auth-middleware boundary:
```ts
const mockVerifyIdToken = vi.fn();
vi.mock("@/config/firebase", () => ({
  auth: { verifyIdToken: mockVerifyIdToken },
  /* … */
}));
mockVerifyIdToken.mockResolvedValueOnce({
  uid: "super-1", email: "x@y.z", email_verified: true,
  roles: ["super_admin"],
});
```

Use `fastify.inject()` for route gates, error mapping, and validation 400s. Use service-level tests (mocked repos) for business logic — don't double-test the gate.

## Templates

When asked to scaffold a new test, reach for the closest existing file as a template rather than starting blank:

| New thing you're testing | Best template |
|---|---|
| Service method with read-then-write transaction | `apps/api/src/services/__tests__/event.service.test.ts` (search for `EventService.restore`) |
| Bulk transactional service method | `apps/api/src/services/__tests__/event.service.recurring.test.ts` (`cancelSeries`) |
| Read-only admin observability service | `apps/api/src/services/__tests__/admin.observability.test.ts` |
| Cross-org admin route | `apps/api/src/routes/__tests__/admin.routes.test.ts` (deny matrix + happy paths) |
| Domain event listener | `apps/api/src/events/__tests__/audit.listener.test.ts` |
| React hook (frontend) | `apps/web-backoffice/src/hooks/__tests__/use-row-keyboard-nav.test.tsx` |
| React component | `apps/web-backoffice/src/components/admin/__tests__/audit-diff-view.test.tsx` |
| Cron / time-sensitive logic | `apps/api/src/services/__tests__/admin.observability.test.ts` (uses fixed-date assertions) |

## Snapshot Tests — Pinning Discipline

Three snapshots are load-bearing in this repo:

| Snapshot | Purpose | When to update |
|---|---|---|
| `apps/api/src/__tests__/__snapshots__/route-inventory.test.ts.snap` | Pins every API route + its auth/permission gate | Always run `npx vitest run src/__tests__/route-inventory.test.ts -u` after adding a route |
| `apps/api/src/__tests__/__snapshots__/permission-matrix.test.ts.snap` | Pins role × permission access matrix | Same — always update on permission catalog edits |
| `packages/shared-types/src/__tests__/__snapshots__/contract-snapshots.test.ts.snap` | Pins serialised Zod shapes (audit actions, plan keys, etc.) | Update on any shared-types schema change. The diff IS the review |

**Never blindly accept a snapshot diff.** Read it line-by-line. Adding a route should add ONE line; if the diff also mutates a different route's gate, that's a regression.

## Determinism Rules

1. **Fix the clock when relevant.** For age / window logic, use `vi.setSystemTime(new Date("2026-04-25T12:00:00Z"))` in `beforeEach` and `vi.useRealTimers()` in `afterEach`. The 30-day restore window test (Sprint-2 T2.2) is the canonical example.
2. **No `Math.random()` in tests.** Stub the random source (`crypto.randomUUID`, `Math.random`, `nanoid`) when the test asserts on output.
3. **No real network.** `fetch` calls go through a `vi.spyOn(global, "fetch")` mock or a mocked module wrapper (see SOC-alert listener tests).
4. **No real timers.** Polling / interval logic uses `vi.useFakeTimers()` + `vi.advanceTimersByTime(N)`.
5. **No real `navigator.clipboard`.** Override in jsdom: `Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() } })`.
6. **No emulator dependence in unit tests.** Anything under `__tests__/` MUST run with zero external services. Emulator-driven tests live in a separate folder when we add them (none today).

## Anti-Patterns We've Already Tripped On

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Asserting on `mockTxUpdate.mock.calls[0][1]` without `toMatchObject` | Order changes when handlers are added/removed | Use `expect(mockTxUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ … }))` |
| `clearAllMocks()` instead of `mockReset()` | Doesn't drop `mockResolvedValueOnce` queue → leaks between tests | `mockTxGet.mockReset()` in `beforeEach` |
| Hand-rolled AuthUser with missing fields | Breaks on every shape change | Use `buildAuthUser(...)` |
| Hardcoded `EXPECTED_HANDLER_COUNT` without comment | Silent breakage on listener add/remove | Comment WHY the number is what it is — every Sprint added 1-3 listeners and the test caught each one |
| Test that passes when the implementation is wrong | Mocks are too permissive (always-truthy returns) | Assert on the FULL output shape with `toEqual` or `toMatchObject` for the meaningful fields |
| Asserting on French copy verbatim | Brittle when copy gets polished | Match by data attribute or aria-label, not by text content. Exception: l10n verification tests |

## Coverage Heuristic for New Code

After writing a feature, run this checklist:

- [ ] Service method: 4 mandatory cases (happy / permission / org-access / error)
- [ ] Service emits domain events: assert the emit happened with the right payload
- [ ] Service uses a Firestore transaction: assert `mockTxUpdate` / `mockTxSet` called inside the tx callback
- [ ] Service has a plan-limit check: test the case where the limit is hit (PlanLimitError thrown)
- [ ] Route: at least one happy + one 401 (unauth) + one 403 (wrong role) + one 400 (invalid body)
- [ ] Snapshot tests refreshed: `route-inventory`, `permission-matrix`, contract snapshots
- [ ] Listener: subscribed to the right event name + writes the audit row with the right action
- [ ] Frontend hook: starts at the empty state, transitions on the standard inputs, cleans up on unmount
- [ ] Frontend component: renders the empty / loading / error / success states

If a checkbox is unticked, **tick it before opening the PR** — `test-coverage-reviewer` (subagent) will block on missing rows.

## Running

```bash
# All API tests
cd apps/api && npx vitest run

# Single file
cd apps/api && npx vitest run src/services/__tests__/event.service.test.ts

# Update snapshots after a deliberate change
cd apps/api && npx vitest run -u

# Watch mode while developing
cd apps/api && npx vitest

# Coverage
cd apps/api && npx vitest run --coverage
```

The full suite finishes in ~25 s on a developer machine. CI runs it on every PR.

## Cross-Reference

- `CLAUDE.md` § "Pre-Implementation Checklist" → security rules each test must encode
- `CLAUDE.md` § "Testing" → high-level overview
- `.claude/agents/test-coverage-reviewer.md` → the subagent that mechanically enforces the checklist above
- `.claude/agents/firestore-transaction-auditor.md` / `domain-event-auditor.md` / `plan-limit-auditor.md` → adjacent enforcers; together with `test-coverage-reviewer` they cover the four orthogonal axes of correctness (race, audit, money, coverage)
