# ADR-0011: RBAC with granular `resource:action` permissions, not flat roles

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

The platform has seven distinct user types: participant, organizer, co-organizer, speaker, sponsor, staff (scanner), super-admin. Each has overlapping needs (a co-organizer can do most of what an organizer can do, but not on the same scope). Some actions require finer granularity than a role implies (a "staff" user must scan but not export the registration list).

Three RBAC models were considered:

1. **Flat roles** — `role: "organizer"` checks like `if (user.role === "organizer")`. Simple, but every new conditional bloats the role check sites.
2. **Role hierarchy** — `super_admin > organizer > co_organizer > staff > participant`. Doesn't fit; co-organizer ≠ stricter organizer (different scope, not different power).
3. **Permission strings** — roles map to sets of `resource:action` permissions; checks are against the permission, not the role.

The platform also has three scopes (global, organization, event) that intersect with roles. A user can be `organizer` at organization level for org A, and `co_organizer` at event level for an event in org B.

---

## Decision

**Permissions are granular `resource:action` strings. Roles are bundles of permissions. Scope is a separate concept resolved at authentication time.**

```typescript
// Permission string
type Permission = "event:create" | "event:publish" | "registration:read_all" | ...;

// Role bundle
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  participant: ["registration:create", "badge:view_own", "feed:read", "messaging:send"],
  organizer:   [...PARTICIPANT, "event:create", "event:publish", "registration:read_all", ...],
  staff:       [...PARTICIPANT, "checkin:scan", "checkin:manual", "registration:read_all"],
  ...
};

// Resource scope
type ResourceScope = "global" | { organizationId: string } | { eventId: string };

// Role assignment
interface RoleAssignment {
  role: Role;
  scope: ResourceScope;
}
```

A request's effective permissions are computed by `resolvePermissions(user)` which expands every assignment in `user.customClaims.roles` to its permission set, intersected with the request's target scope.

Permission middleware: `requirePermission("event:create")` runs `hasPermission(user, "event:create", scope)` and 403s on miss.

---

## Reasons

- **Granularity.** Adding a new feature means adding a permission string, not editing a role enum. Example: Phase 2 added `event:clone` — a single line in the permissions list, no role refactor.
- **Scope-aware.** A user can be `organizer` for org A and `participant` for org B without role conflicts. The scope is part of the assignment, not implied.
- **Super-admin bypass is explicit.** `super_admin` has a single permission `platform:manage` that resolves to "all permissions" via `hasPermission` short-circuit. No magic role check.
- **Audit-friendly.** Every denial logs the missing permission (`Permission manquante: event:publish`) — actionable error message.
- **Frontend reusable.** The same `hasPermission` function runs in the React components to hide CTAs the user can't access.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Flat roles + role hierarchy | Doesn't model scope. Co-organizer is not a "weaker" organizer; it's the same role on a narrower scope. |
| Casbin / external policy engine | Overkill for the MVP. Would re-evaluate at >50 distinct permissions or if dynamic policies are needed. |
| Firebase Auth custom claims as the only source | Custom claims have a 1KB limit. We hit it at ~7 role assignments. Decision: store assignments in Firestore (`users/{uid}.roleAssignments[]`), reflect a compact summary in custom claims (`organizationId`, `primaryRole`). |

---

## Conventions

- **Permission name format:** `<resource>:<action>` — e.g. `event:create`, `registration:read_all`, `checkin:scan`.
- **Action vocabulary:** `create`, `read`, `read_own`, `read_all`, `update`, `update_own`, `archive`, `cancel`, `publish`, `scan`, `manual`, `manage`, `view_own`, `delete_pii`. New actions go in this enum or are rejected by the linter.
- **Roles are immutable** in the seed data; permissions can be added without a migration.
- **Scope resolution** happens in `auth.middleware.ts` at request time — services just call `requirePermission(...)` against the resolved set.
- **Defense in depth** — the API enforces, the Firestore rules also enforce. Both must pass.

---

## Consequences

**Positive**

- Adding a feature is one permission string + one middleware call.
- Frontend gating uses the same source of truth.
- Audit logs identify the exact permission required for each denial.
- The `permission-matrix.test.ts` snapshot detects unintended permission changes.

**Negative**

- More moving parts than flat roles. Mitigated by the `resolvePermissions` helper and a typed `Permission` union in `@teranga/shared-types/permissions.types.ts`.
- Custom claim size watch — must keep the claim payload small. Mitigated by storing role assignments in Firestore and only reflecting a digest in claims.
- Token refresh required after role changes (claims live in the JWT). Documented in CLAUDE.md "Common Pitfalls".

**Follow-ups**

- Permission catalog browser in the admin panel (planned, Wave 8).
- Per-org custom permission overrides (planned, enterprise plan only).

---

## References

- `packages/shared-types/src/permissions.types.ts` — Permission union, role bundles, scope types.
- `apps/api/src/middlewares/permission.middleware.ts` — `requirePermission` factory.
- `apps/api/src/__tests__/__snapshots__/permission-matrix.test.ts.snap` — change detection.
- CLAUDE.md → "Permission-Based Access Control (RBAC)" section.
