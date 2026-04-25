# ADR-0012: Multi-tenancy via `organizationId` in Firebase custom claims

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

Teranga is a SaaS platform. Every organizer belongs to an organization. Events, registrations, members, sessions, sponsors — all org-scoped. Cross-org data leakage is the worst thing the platform can do (commercial-grade trust failure, GDPR violation, reputational damage).

Three models for tenant isolation existed:

1. **Database-per-tenant** — separate Firestore project per organization. Maximum isolation, prohibitive cost, painful operations.
2. **Schema-per-tenant** — separate top-level collection per org (`org_<id>_events`, `org_<id>_registrations`). Hard to query across orgs (super-admin views), Firestore rules become enormous.
3. **Row-level (`organizationId` field on every doc)** — single set of collections, every doc carries `organizationId`, queries always filter by it.

The platform also needs to support users who legitimately participate across orgs (a participant registers for events in 5 different orgs) — a strict per-tenant container model fights this.

---

## Decision

**All org-scoped collections store `organizationId` on the document. The user's primary `organizationId` is reflected in their Firebase custom claims. Every service method that touches org-scoped data calls `requireOrganizationAccess(user, organizationId)`.**

```typescript
// Custom claims (set on user creation, refreshed on role change)
{
  uid: "abc123",
  email: "moussa@example.com",
  customClaims: {
    organizationId: "org_dakar_digital_hub",  // primary org
    roleAssignments: [
      { role: "organizer", scope: { organizationId: "org_dakar_digital_hub" } },
      { role: "co_organizer", scope: { eventId: "evt_2026_summit" } }
    ]
  }
}

// Service code
async getEvent(eventId: string) {
  const event = await this.repo.findById(eventId);
  this.requireOrganizationAccess(this.user, event.organizationId);  // throws ForbiddenError if mismatch
  return event;
}

// Firestore rules (defense in depth)
match /events/{eventId} {
  allow read: if request.auth.token.organizationId == resource.data.organizationId
              || hasPermission('platform:manage');
}
```

Participants don't have an `organizationId` claim — their access is event-scoped (registration grants read access to the event document, not the org's other events).

---

## Reasons

- **Single Firestore project** — operationally trivial (backups, indexes, monitoring all unified).
- **Defense in depth** — API service enforces, Firestore rules enforce. Two independent gates.
- **Cross-org queries possible for super-admin** — single collection, single query.
- **Participants are first-class** — no awkward "guest tenant" concept.
- **Custom claims hot-path** — `request.auth.token.organizationId` is available without an extra Firestore read in every rule.
- **Audit trail consistent** — every audit log carries `organizationId`, queries by org are trivial.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Database-per-tenant | Cost-prohibitive at MVP scale; blocks super-admin views; deployment complexity. |
| Schema-per-tenant (collection prefixing) | Firestore rules become unmaintainable; participants who cross orgs need duplicate access logic. |
| Trust the API only (no rules check) | A single API bug leaks every org's data. Defense in depth is not optional for a multi-tenant SaaS. |
| Storing `organizationId` only on the user doc, not on every record | Every read needs a join (extra Firestore read). Doesn't compose with rules. |

---

## Conventions

- **Every org-scoped document has `organizationId: string`** as a top-level field (not nested).
- **Firestore rules check `request.auth.token.organizationId == resource.data.organizationId`** for org-scoped reads/writes (with super-admin bypass).
- **Service methods call `requireOrganizationAccess(user, doc.organizationId)`** before reads or writes — even after rules have approved (defense in depth, also catches Admin SDK paths that bypass rules).
- **`organizationId` is immutable** after creation. Firestore rules enforce `request.resource.data.organizationId == resource.data.organizationId` on update.
- **Cross-org operations** (super-admin only) require explicit `platform:manage` permission and audit each access.

---

## Consequences

**Positive**

- Single project, single rule set, single audit pipeline.
- Cross-org leaks require breaking both API and rules — extremely unlikely.
- Participants traverse orgs cleanly (registration is the bridge).
- Super-admin views are simple queries.

**Negative**

- Every developer must remember to call `requireOrganizationAccess`. Mitigated by the `security-reviewer` agent + the four mandatory test cases that include "org-access denial" by default.
- Composite indexes need `organizationId` as a leading field on most query patterns (e.g., `(organizationId, status, createdAt)`). Increases index count.
- Firestore custom claim has a 1KB hard limit — only `organizationId` (the primary) is stored. Multi-org users (rare; mostly super-admin) get a fallback path via `users/{uid}.roleAssignments`.

**Follow-ups**

- Phase 2 may add per-org data export to satisfy enterprise customers' "give us our data in a clean dump" requests.
- Cross-org reporting for super-admin dashboards (Wave 8).

---

## References

- `apps/api/src/services/base.service.ts` — `requireOrganizationAccess()` implementation.
- `infrastructure/firebase/firestore.rules` — `isMyOrg()` helper.
- `apps/api/src/services/__tests__/security-audit.test.ts` — covers org-access checks.
- CLAUDE.md → "Multi-tenancy via Organizations" + "Security Hardening Checklist".
