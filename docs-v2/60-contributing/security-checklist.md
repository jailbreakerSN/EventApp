---
title: Security Checklist
status: shipped
last_updated: 2026-04-25
---

# Security Checklist

Run these checks before every PR that touches API services, routes, Firestore rules, or file uploads.

---

## Pre-implementation checklist

Before writing any code, evaluate the change against these dimensions:

### 1. Multi-tenancy isolation
- [ ] Does this operation access org-scoped data? → `requireOrganizationAccess()` must be called first
- [ ] Is `organizationId` correctly propagated to every new document?
- [ ] Are Firestore rules preventing cross-org reads?

### 2. Permissions
- [ ] Is the correct `resource:action` permission checked? See [permissions reference](../20-architecture/reference/permissions.md)
- [ ] Does the route have `requirePermission('...')` in `preHandler`?
- [ ] Is super_admin bypass appropriate here?

### 3. Input validation
- [ ] Is all user input validated with a Zod schema from `@teranga/shared-types`?
- [ ] Is the `validate({ body: Schema })` middleware in the route's `preHandler`?
- [ ] Are path params and query params validated too (not just body)?

### 4. File uploads
- [ ] Is MIME type whitelisted against `ALLOWED_CONTENT_TYPES`?
- [ ] Is SVG explicitly excluded? (SVG = XSS vector)
- [ ] Is file size limited?
- [ ] Are uploaded files stored in the correct Cloud Storage path with ownership verification?

### 5. Immutable fields
- [ ] Are any fields that should be immutable after creation protected in Firestore rules with `immutableOnUpdate()`?
- [ ] Are those same fields validated server-side in the service?

### 6. Transaction safety
- [ ] Does this operation read and then write based on the read? → Must use `db.runTransaction()`
- [ ] Does this operation write to multiple related documents atomically? → Must use a transaction

### 7. Logging
- [ ] Are there any `console.log` statements in service code? → Remove and use Pino logger
- [ ] Is sensitive data (passwords, secrets, full tokens) excluded from logs?

---

## Post-implementation checklist

After writing code, verify:

### Service layer
- [ ] Every service method that accesses org data starts with `requireOrganizationAccess()`
- [ ] Every mutation emits a domain event to the event bus
- [ ] Plan-gated features use `requirePlanFeature()` or `checkPlanLimit()`
- [ ] No service method calls another service directly for side effects (use event bus)

### Routes
- [ ] Route has `authenticate`, `validate`, and `requirePermission` in `preHandler`
- [ ] Route handler is thin — business logic is in the service, not the route
- [ ] Response uses the `{ success: true/false, data/error }` envelope

### Firestore rules
- [ ] New collections have explicit rules (never rely on the deny-all default for a new feature)
- [ ] `immutableOnUpdate(['organizationId', ...])` is applied to new org-scoped collections
- [ ] Sensitive collections (badges, notifications, audit_logs) have `allow create: if false`

### Tests
- [ ] Happy path test exists
- [ ] Permission denial test exists (`ForbiddenError` when wrong role)
- [ ] Org isolation test exists (`ForbiddenError` when different org)
- [ ] Plan limit test exists (if the method is plan-gated)

---

## Security hardening rules (always active)

These patterns from the Wave 1 security review must be maintained in all future code:

| Pattern | Rule |
|---|---|
| Org access on reads | `requireOrganizationAccess()` on every non-public data access |
| Org access on writes | `requireOrganizationAccess()` before any mutation |
| Transactional read-write | `db.runTransaction()` for any read-then-modify-then-write |
| Content-type whitelist | Validate against `ALLOWED_CONTENT_TYPES` set |
| No SVG uploads | SVG removed from storage rules and upload whitelist |
| Immutable field guards | Firestore rules prevent mutation of `organizationId`, `userId`, `createdBy`, `qrKid` |
| API client timeout | 30s `AbortController` timeout on all fetch calls in web apps |
| Token refresh on 401 | Single retry with `getIdToken(true)` on auth failure |
| Signed QR codes | HMAC-SHA256 with `timingSafeEqual`, never truncated |
| No hard deletes | Soft-delete only (`status: "archived"` or `"cancelled"`) |

---

## Running automated security checks

Before pushing:
```
@security-reviewer
@firestore-transaction-auditor
@domain-event-auditor
```

For freemium-gated features:
```
@plan-limit-auditor
```

For UI changes:
```
@l10n-auditor
```

These agents are in `.claude/agents/` and can also be triggered via the `claude-review.yml` workflow.
