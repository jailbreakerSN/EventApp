# ADR-0005: Deny-all default in Firestore security rules

**Status:** Accepted  
**Date:** 2026-01

---

## Context

Firebase Firestore security rules can be configured with two default postures:
1. **Allow-all default** — everything is readable/writable until explicitly denied
2. **Deny-all default** — nothing is accessible until explicitly allowed

For a multi-tenant SaaS with PII (participant emails, payment data), the security consequence of a misconfigured rule differs dramatically between these two postures:
- Allow-all misconfiguration: **data is silently exposed**
- Deny-all misconfiguration: **access is silently blocked** (breaks a feature, but no data leak)

---

## Decision

**Use deny-all as the default and require every collection to have explicit rules.**

```javascript
// infrastructure/firebase/firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Deny everything by default — explicit rules below
    match /{document=**} {
      allow read, write: if false;
    }

    match /users/{userId} { ... }
    match /organizations/{orgId} { ... }
    match /events/{eventId} { ... }
    // etc.
  }
}
```

Any new collection that is not explicitly listed defaults to **deny all** — adding a new collection without updating the rules will break functionality, not leak data.

---

## Helper functions

To reduce duplication and enforce consistency:

```javascript
function isAuthenticated() {
  return request.auth != null;
}

function currentUid() {
  return request.auth.uid;
}

function hasRole(role) {
  return request.auth.token.roles != null
    && request.auth.token.roles.hasAny([role]);
}

function isSuperAdmin() {
  return hasRole('super_admin');
}

function belongsToOrg(orgId) {
  return isAuthenticated()
    && request.auth.token.organizationId == orgId;
}

function immutableOnUpdate(fields) {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny(fields);
}
```

---

## Defense-in-depth posture

Firestore rules are the **client-side defense layer**. The API is the **server-side defense layer**. Both must agree:

- API validates inputs with Zod schemas
- API enforces RBAC via `requirePermission()`
- API enforces org isolation via `requireOrganizationAccess()`
- Firestore rules validate the same constraints for any client that bypasses the API (e.g., mobile SDK direct reads)

Neither layer trusts the other. A bug in the API that allows cross-org access is still caught by Firestore rules, and vice versa.

---

## Consequences

- Every new Firestore collection requires a corresponding rule block. Forgetting this results in a 403 error (caught immediately), not a data leak.
- Cloud Functions use the Admin SDK, which bypasses Firestore rules by design. This is acceptable — functions are server-side trusted code, not client-facing.
- Badge PDFs and notifications are written only by Admin SDK (Cloud Functions). The rules for these collections have `allow create: if false` — clients cannot create them directly.
