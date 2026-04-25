---
title: @teranga/shared-types
status: shipped
last_updated: 2026-04-25
---

# @teranga/shared-types

> **Status: shipped** — Single source of truth for all data shapes.

Package: `packages/shared-types/`  
Import: `import { EventSchema, type Event } from '@teranga/shared-types'`

---

## Purpose

`@teranga/shared-types` defines every Zod schema and TypeScript type used by the API, web backoffice, and web participant app. It is the **single source of truth** for:

- Request/response shapes (API DTOs)
- Firestore document schemas
- Enum values (EventStatus, SystemRole, AuditAction, etc.)
- Plan limits and feature flags
- Permission resolution functions

Flutter mirrors these types manually as Dart Freezed models.

---

## Build

Any change to files in `packages/shared-types/src/` requires a rebuild before other packages can consume it:

```bash
npm run types:build
# or
cd packages/shared-types && npm run build
```

The CI gate runs this build first and blocks all downstream jobs if it fails.

---

## Key exports

### Domain schemas

| Export | File | Description |
|---|---|---|
| `EventSchema`, `CreateEventSchema`, `UpdateEventSchema` | `event.types.ts` | Event CRUD shapes |
| `RegistrationSchema`, `RegisterSchema` | `registration.types.ts` | Registration shapes |
| `OrganizationSchema`, `PLAN_LIMITS`, `PlanFeatures` | `organization.types.ts` | Org + freemium |
| `BadgeSchema`, `BadgeTemplateSchema` | `badge.types.ts` | Badge shapes |
| `SubscriptionSchema`, `PlanUsageSchema` | `subscription.types.ts` | Subscription shapes |
| `PlanSchema` | `plan.types.ts` | Plan catalog shapes |
| `PaymentSchema` | `payment.types.ts` | Payment shapes |
| `AuditLogEntrySchema`, `AuditAction` | `audit.types.ts` | 83 audit actions |
| `OfflineSyncDataSchema` | `offline-sync.types.ts` | Offline sync envelope |
| `SessionSchema` | `session.types.ts` | Agenda sessions |
| `VenueSchema` | `venue.types.ts` | Venue shapes |

### Permission system

| Export | Description |
|---|---|
| `SystemRole` | Union type of all 7 system roles |
| `Permission` | Union type of all `resource:action` strings |
| `ROLE_PERMISSIONS` | Record mapping each role to its permissions |
| `resolvePermissions(roles)` | Returns the full `Set<Permission>` for a user's roles |
| `hasPermission(user, permission)` | Boolean check |
| `hasAllPermissions(user, perms[])` | Boolean check (AND) |
| `hasAnyPermission(user, perms[])` | Boolean check (OR) |

### Plan enforcement

| Export | Description |
|---|---|
| `PLAN_LIMITS` | `@deprecated Phase 6` — hardcoded plan limits |
| `PLAN_DISPLAY` | Display info (name fr/en, priceXof, color) |
| `PlanFeature` | Union type of 11 feature flag keys |
| `PlanFeatures` | Interface with 11 boolean flags |
| `PlanLimits` | `{ maxEvents, maxParticipantsPerEvent, maxMembers, features }` |
| `PLAN_LIMIT_UNLIMITED` | `-1` — Firestore representation of Infinity |

---

## Snapshot tests

`packages/shared-types/src/__tests__/snapshot.test.ts` contains snapshot tests that catch **breaking shape changes** — if you add a required field or remove a field, the snapshot diff shows the change for review.

`packages/shared-types/src/__tests__/permissions.types.test.ts` contains a permission matrix snapshot. Any change to RBAC must update this snapshot intentionally.

---

## Adding a new type

1. Create or edit the relevant `*.types.ts` file in `packages/shared-types/src/`
2. Export from `packages/shared-types/src/index.ts`
3. Run `npm run types:build`
4. Import in consuming packages: `import { type MyType } from '@teranga/shared-types'`

See [Cookbook: Modifying shared types](../../60-contributing/cookbooks/modifying-shared-types.md).
