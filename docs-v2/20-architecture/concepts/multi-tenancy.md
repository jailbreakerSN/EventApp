---
title: Multi-Tenancy & Org Isolation
status: shipped
last_updated: 2026-04-25
---

# Multi-Tenancy & Org Isolation

> **Status: shipped** — Org isolation is enforced at every layer.

---

## The invariant

**Every piece of organizer data belongs to exactly one organization, and a user can only access data belonging to their own organization.**

This is the most critical security property in the platform. Violating it leaks one customer's event data to another customer.

---

## Data model

Every organizer-owned entity has an `organizationId` field:

- `events.organizationId`
- `registrations` → scoped via `eventId` → `event.organizationId`
- `badgeTemplates.organizationId`
- `subscriptions.organizationId`
- `invites.organizationId`
- `venues.hostOrganizationId`

`organizationId` is set at creation time and is **immutable**. Firestore rules enforce this:

```javascript
// firestore.rules
function immutableOnUpdate(fields) {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny(fields);
}

match /events/{eventId} {
  allow update: if isOrgMember(resource.data.organizationId)
    && immutableOnUpdate(['organizationId', 'createdBy', 'qrKid', 'qrKidHistory']);
}
```

The API also validates immutability server-side — defense-in-depth.

---

## API enforcement

Every service method that reads or writes org-scoped data must call `requireOrganizationAccess()` from `BaseService`:

```typescript
// BaseService
async requireOrganizationAccess(user: AuthUser, orgId: string): Promise<void> {
  if (user.roles.includes('super_admin')) return; // bypass for platform admin
  if (user.organizationId !== orgId) {
    throw new ForbiddenError('You do not have access to this organization');
  }
}
```

Example usage in `EventService`:

```typescript
async update(user: AuthUser, orgId: string, eventId: string, data: UpdateEventDto) {
  await this.requireOrganizationAccess(user, orgId);          // ← must be first
  await this.requirePermission(user, 'event:update');
  // ... rest of update logic
}
```

**If `requireOrganizationAccess()` is missing from a service method, the security-reviewer CI agent flags it.**

---

## Firebase Auth custom claims

The user's `organizationId` is stored in their Firebase Auth JWT custom claims. This means:

1. The API reads `request.user.organizationId` from the JWT — zero extra Firestore reads.
2. The Firestore security rules read `request.auth.token.organizationId` for client-SDK access.

```typescript
// authenticate middleware
const decodedToken = await admin.auth().verifyIdToken(token);
request.user = {
  uid: decodedToken.uid,
  email: decodedToken.email,
  roles: decodedToken.roles ?? ['participant'],
  organizationId: decodedToken.organizationId ?? null,
  orgRole: decodedToken.orgRole ?? null,
  emailVerified: decodedToken.email_verified,
};
```

---

## Organization membership model

Users join an organization with one of four internal roles:

| `orgRole` | Capabilities |
|---|---|
| `owner` | Full control including deleting the org. Assigned at org creation. Cannot be transferred via invites. |
| `admin` | Manage events and members. Cannot delete org. |
| `member` | Manage own events and view analytics. |
| `viewer` | Read-only access. |

`orgRole` controls access within the organization. The system-level `SystemRole` (e.g., `organizer`, `staff`) controls which API permissions are granted. Both must be checked for sensitive operations.

---

## Multi-organization users

The current model is **one organization per user** (enforced at the data model level — `user.organizationId` is a single value). A user can be:
- An organizer in one org and a participant globally
- A participant with no org

Super-admins have `organizationId: null` — they bypass org isolation in all service checks.

---

## Firestore security rules structure

```javascript
match /organizations/{orgId} {
  allow read: if isAuthenticated() && (belongsToOrg(orgId) || isSuperAdmin());
  allow create: if isAuthenticated() && request.resource.data.ownerId == currentUid();
  allow update: if belongsToOrg(orgId) && hasOrgRole(['owner', 'admin']);
  allow delete: if isSuperAdmin();
}

match /events/{eventId} {
  // Public events: any authenticated user can read
  allow read: if isAuthenticated() && (
    resource.data.status == 'published' && resource.data.isPublic == true
    || belongsToOrg(resource.data.organizationId)
    || isSuperAdmin()
  );
  allow create: if belongsToOrg(request.resource.data.organizationId)
    && hasRole('organizer');
  allow update: if belongsToOrg(resource.data.organizationId)
    && immutableOnUpdate(['organizationId', 'createdBy', 'qrKid']);
  allow delete: if false; // soft-delete only
}
```

---

## Event-scoped roles (co_organizer, staff, speaker, sponsor)

Some roles are scoped to a specific event, not the whole organization. The event-scoped role assignment is stored on the user's custom claims as part of the `roles` array with event context, or resolved at runtime from the event's `staffIds`, `speakerIds`, etc.

Event-scoped role resolution in `resolvePermissions()`:

```typescript
// A staff user's permissions are checked against the eventId in the request context
if (user.roles.includes('staff') && context.eventId === user.staffEventIds.includes(context.eventId)) {
  permissions.add('checkin:scan');
}
```

---

## Super-admin bypass

Super-admins bypass **all** org isolation checks and **all** permission checks. This is intentional — the super-admin role is restricted to platform operators and enforced at the claims level.

The bypass is implemented as an early return in `requireOrganizationAccess()` and in Firestore rules via `isSuperAdmin()`:

```javascript
function isSuperAdmin() {
  return request.auth.token.roles != null
    && request.auth.token.roles.hasAny(['super_admin']);
}
```

---

## What to check when adding a new entity

When adding a new Firestore collection that is org-scoped:

1. Add `organizationId` field to the Zod schema in `packages/shared-types/`
2. Add `immutableOnUpdate(['organizationId'])` to the Firestore rules
3. Call `requireOrganizationAccess()` in every service method that reads or writes the collection
4. Add a test case: "user from org B cannot read/write org A's data"
