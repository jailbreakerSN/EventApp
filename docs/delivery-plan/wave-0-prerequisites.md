# Pre-Wave: Foundation Hardening

**Status:** `completed`
**Estimated effort:** 3-4 days
**Completed:** 2026-04-05
**Goal:** Ensure the codebase is solid, tested, and CI-ready before building features.

## Why This Wave Exists

The backend foundations (routes, services, repos, middleware, RBAC, transactions, audit) are at ~85%. Before building user-facing features, we need to close remaining gaps so every subsequent wave builds on rock-solid infrastructure.

---

## Tasks

### 1. CI/CD Pipeline
- [x] GitHub Actions workflow: lint + type-check + test on PR
- [x] Turborepo cache for faster CI runs
- [x] Separate workflows for API, web, shared-types
- [ ] Firebase emulator-based integration test job (future — deferred to Wave 10)

### 2. Test Coverage Gaps
- [x] Service-layer tests for `event.service.ts` (create, update, publish, cancel, archive — 20 tests)
- [x] Service-layer tests for `organization.service.ts` (create, getById, update, addMember, removeMember — 13 tests)
- [x] Route-level integration tests using `fastify.inject()` (health routes 3 tests, events routes 12 tests)
- [x] All 96 tests pass (up from 48) across 10 test files

### 3. Environment & Config
- [x] Validate `.env.example` files are complete and accurate for all apps
- [ ] Document Firebase emulator setup in a contributor guide (deferred — low priority)
- [x] Verify `QR_SECRET` validation (>= 16 chars) works at startup

### 4. Shared Types Completeness
- [x] Audit all Zod schemas against actual Firestore document shapes
- [x] Ensure all API request/response schemas exist in `@teranga/shared-types`
- [x] Add missing schemas for audit logs (AuditLogEntrySchema, AuditActionSchema), registration requests (CreateRegistrationSchema, CheckInSchema)

### 5. Firestore Rules Audit
- [x] Verify rules match current collection structure
- [x] Add rules for `auditLogs` collection (super_admin read only, no client write)
- [x] Add rules for `offlineSync` collection (staff/organizer read, admin write only)
- [x] Fix registration update rules: split into owner cancel-only, staff/organizer field-restricted, super_admin unrestricted
- [x] Fix badge read: add `belongsToOrg()` check to prevent cross-org data leaks
- [x] Fix offline sync: add `belongsToOrg()` org validation
- [x] Fix feed post comments: add `onlyChanges()` field restriction
- [ ] Test rules with Firebase emulator rule testing SDK (deferred to Wave 10)

### 6. Lint & Code Quality (bonus)
- [x] Fix all ESLint errors (0 errors, was 10)
- [x] Fix unused imports (cert, ZodError, UserProfile, SystemRole, beforeEach)
- [x] Fix inline import() type annotations (badge.service, notification.service)
- [x] Fix missing OrganizationPlan type import
- [x] Type-check passes with zero errors

### 7. Post-Review Hardening
- [x] Extract QR signing functions to dedicated module (`qr-signing.ts`) — eliminates test code duplication
- [x] Replace timing-dependent `setTimeout` in event-bus/audit tests with deterministic `setImmediate` flushing
- [x] Fix factory IDs: `crypto.randomUUID()` instead of counter-based (parallel test safety)
- [x] Add `package.json` and `package-lock.json` to turbo.json globalDependencies
- [x] Remove test file exclusion from API tsconfig (tests now type-checked)
- [x] Add `format:check` and `type-check` scripts to root package.json
- [x] Remove all CI `|| true` silent failure patterns

---

## Exit Criteria

- [x] All tests green (96 tests, 10 files)
- [x] Lint + type-check pass across API
- [x] `.env.example` files documented and complete
- [x] Firestore rules updated for auditLogs + offlineSync
- [x] Shared types rebuilt with audit/registration schemas
- [x] CI pipeline enhanced with Turborepo caching, parallel jobs, CI gate

## Dependencies

None — this is the starting point.

## Deploys After This Wave

- CI pipeline is active
- No user-facing changes

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Test files | 6 | 10 |
| Total tests | 48 | 96 |
| ESLint errors | 10 | 0 |
| Type errors | 2 | 0 |
| Shared-types schemas | 7 files | 8 files |
| Firestore rule collections | 10 | 12 |
| CI jobs | 6 | 8 (split API lint/test + CI gate) |
