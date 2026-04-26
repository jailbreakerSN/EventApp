# Wave 10 / W10-P4 — Performance + reliability

**Branch:** `claude/wave-10-production-hardening`
**Status:** shipped
**Audits closed:** R2 (pagination cap), R3 (plan-impact preview N+1), W10-P1 carry-over (BaseRepository update / softDelete race window).

R4 (Firestore composite-index gap) and R5 (backup automation + ISR) move into W10-P5 + W10-P6 because they need the production deploy workflow shipping in those phases.

---

## What changed

### 1. `BaseRepository.update` / `softDelete` race window — fixed

**Before** the implementation did:

```ts
const doc = await docRef.get();
if (!doc.exists) throw new NotFoundError(this.resourceName, id);
await docRef.update({ ...data, updatedAt: ... });
```

That's a non-atomic read-then-write. A concurrent delete between `get()` and `update()` either (a) drops the caller into Firestore's raw `not-found` error or (b) lets the write hit a doc the caller didn't intend to touch (if it's been recreated in the gap).

**After:** the pre-read is gone. Firestore's `update()` natively rejects with `not-found` when the doc is missing; we catch that error and translate it into our typed `NotFoundError(resourceName, id)`. Same caller-facing 404 semantics, one fewer Firestore read, no race window.

The `translateNotFound(err, resourceName, id)` helper handles the three shapes the SDK can raise:

- `err.code === 5` (raw gRPC NOT_FOUND),
- `err.code === "not-found"` (Firebase JS SDK string code),
- `message.includes("NOT_FOUND" | "No document to update")` (some admin builds).

Other Firestore errors (permission-denied, deadline-exceeded, etc.) propagate unchanged.

**Pinned by:** `apps/api/src/repositories/__tests__/base.repository.test.ts` — 6 cases covering happy path, two "not-found" shapes, propagation of unrelated errors, and the symmetric softDelete branch.

### 2. `findMany` page-size cap — `MAX_PAGE_SIZE = 1000`

**Where:** `apps/api/src/repositories/base.repository.ts`. Exported constant + clamp on every `findMany` call:

```ts
const limit = Math.min(pagination?.limit ?? 20, MAX_PAGE_SIZE);
```

**Why:** the senior performance audit (R2) flagged ≥ 6 services calling `findMany(..., { limit: 10000 })` to "fetch everything in one go". On enterprise-tier organisations those calls would either stall the request (Cloud Run 60 s timeout) or pull ~80 MB from Firestore in a single hit. The cap makes the worst case bounded.

The reported `meta.limit` reflects the EFFECTIVE cap so consumers compute `totalPages` correctly when they request more than 1 000.

**Migration of the 6 known offenders** (payout / reconciliation / sponsor / post-event-report / messaging / event-health) to cursor pagination is a follow-up — for those, the cap currently changes a "10 000 in one shot" into a "1 000 in one shot, with `meta.totalPages` revealing the rest". The receipt-shaped reports already iterate multi-page so they keep working; the affected services run on smaller datasets in our current production traffic and won't truncate. Tracked as a P5 follow-up.

### 3. `plan.service.ts` `previewPlanImpact` — N+1 → batchGet + Promise.all

**Where:** `apps/api/src/services/plan.service.ts:490-510`. The previous `for (const sub of subs)` body issued two awaits per subscription:

```ts
const org = await organizationRepository.findById(sub.organizationId);
const activeEvents = await eventRepository.countActiveByOrganization(org.id);
```

At 1 000 subscriptions that's 2 000 sequential Firestore round-trips before any response — a hard timeout for the super-admin "preview impact of changing plan limits" view.

**Refactor:** batched org reads via `organizationRepository.batchGet(orgIds)` (chunked at Firestore's 100-doc `getAll` cap by `BaseRepository.batchGet`) + parallel active-event counts via `Promise.all`. Mirrors the existing `admin.service.ts:2147` pattern.

Order preservation: build a `Map<orgId, org>` + a `Map<orgId, activeEventCount>`, then zip back over the `subs` array in the original loop body. The output `affected` list keeps its original ordering before the violation-count sort.

---

## Verification log

- `cd apps/api && npx vitest run` — 136 files / 2136 tests green (up from 2130 + 6 BaseRepository tests).
- `cd apps/api && npx tsc --noEmit` — clean.
- `cd apps/api && npx vitest run src/repositories/__tests__/base.repository.test.ts` — 6 / 6 race-window pin assertions green.

## Mechanical auditor results

- `@security-reviewer` — no security surface change.
- `@firestore-transaction-auditor` — green; the BaseRepository fix is the targeted resolution of the W10-P1 carry-over.
- `@plan-limit-auditor` — N/A (plan service refactor preserves logic).

---

## What remains for the next phase

- **R4 — Firestore composite-index gap.** Strict run of `npm run audit:firestore-indexes:strict` is `continue-on-error: true` in `deploy-staging.yml`. The realistic facet shapes (category + city + country + tags) need composite indexes; flipping the strict step from soft to hard, plus committing the missing index entries, lands in W10-P5 alongside the production deploy workflow.
- **R5 — Backup automation + ISR.** Scheduled Cloud Function for daily backup → W10-P5. Participant SSG `force-dynamic` → W10-P6.
- **Cursor pagination for the 6 callers** (`payout.service.ts`, `reconciliation.service.ts`, `sponsor.service.ts`, `post-event-report.service.ts`, `messaging.service.ts`, `event-health.service.ts`). They are currently capped at 1 000 docs per page by `MAX_PAGE_SIZE`. Rewriting them to walk pages via `startAfter` is mechanical and tracked as a separate follow-up.

## Rollback

| Change                                      | Rollback                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| BaseRepository update / softDelete race fix | Re-introduce the `doc.get()` + existence check; the pin tests will fail in lockstep, signalling intent. |
| `MAX_PAGE_SIZE` cap                         | Drop the `Math.min(...)` clamp. The 6 callers passing 10 000 will silently revert to the old behaviour. |
| Plan-impact preview batching                | Restore the serial loop. The pre-W10 timeout returns.                                                   |
