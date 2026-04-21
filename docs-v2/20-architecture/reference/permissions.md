# Permissions Reference

> **Status: shipped** — Defined in `packages/shared-types/src/permissions.types.ts`.

---

## Permission format

All permissions follow the `resource:action` pattern. Permissions are checked via:

```typescript
hasPermission(user, 'event:create')
hasAllPermissions(user, ['event:create', 'badge:generate'])
hasAnyPermission(user, ['checkin:scan', 'checkin:manual'])
```

The `super_admin` role implies ALL permissions and bypasses all permission checks.

---

## Full permission table

### event

| Permission | participant | organizer | co_organizer | staff | speaker | sponsor | super_admin |
|---|---|---|---|---|---|---|---|
| `event:read` | ✅ (public) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `event:create` | — | ✅ | — | — | — | — | ✅ |
| `event:update` | — | ✅ | ✅ | — | — | — | ✅ |
| `event:publish` | — | ✅ | ✅ | — | — | — | ✅ |
| `event:cancel` | — | ✅ | — | — | — | — | ✅ |
| `event:archive` | — | ✅ | — | — | — | — | ✅ |
| `event:clone` | — | ✅ | — | — | — | — | ✅ |
| `event:manage_speakers` | — | ✅ | ✅ | — | — | — | ✅ |
| `event:manage_sponsors` | — | ✅ | ✅ | — | — | — | ✅ |

### registration

| Permission | participant | organizer | co_organizer | staff | super_admin |
|---|---|---|---|---|---|
| `registration:create` | ✅ | — | — | — | ✅ |
| `registration:read_own` | ✅ | — | — | — | ✅ |
| `registration:read_all` | — | ✅ | ✅ | ✅ | ✅ |
| `registration:cancel_own` | ✅ | — | — | — | ✅ |
| `registration:cancel_any` | — | ✅ | ✅ | — | ✅ |
| `registration:approve` | — | ✅ | ✅ | — | ✅ |
| `registration:export` | — | ✅ (Starter+) | ✅ (Starter+) | — | ✅ |

### badge

| Permission | participant | organizer | co_organizer | staff | super_admin |
|---|---|---|---|---|---|
| `badge:view_own` | ✅ | — | — | — | ✅ |
| `badge:view_all` | — | ✅ | ✅ | — | ✅ |
| `badge:generate` | — | ✅ (Starter+) | ✅ (Starter+) | — | ✅ |

### checkin

| Permission | organizer | co_organizer | staff | super_admin |
|---|---|---|---|---|
| `checkin:scan` | ✅ | ✅ | ✅ | ✅ |
| `checkin:manual` | ✅ | ✅ | ✅ | ✅ |
| `checkin:view_log` | ✅ | ✅ | ✅ | ✅ |
| `checkin:sync_offline` | ✅ | ✅ | ✅ | ✅ |
| `checkin:bulk_reconcile` | ✅ | ✅ | ✅ | ✅ |

### organization

| Permission | organizer | co_organizer | super_admin |
|---|---|---|---|
| `organization:read` | ✅ | ✅ | ✅ |
| `organization:update` | ✅ | — | ✅ |
| `organization:manage_members` | ✅ | — | ✅ |
| `organization:delete` | owner only | — | ✅ |
| `organization:create` | ✅ | — | ✅ |

### analytics

| Permission | organizer | co_organizer | super_admin |
|---|---|---|---|
| `analytics:read` | ✅ (Pro+) | ✅ (Pro+) | ✅ |
| `analytics:platform` | — | — | ✅ |

### feed

| Permission | participant | organizer | co_organizer | speaker | super_admin |
|---|---|---|---|---|---|
| `feed:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `feed:create_post` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `feed:delete_post` | own only | ✅ | ✅ | own only | ✅ |
| `feed:manage_content` | — | ✅ | ✅ | — | ✅ |
| `feed:moderate` | — | ✅ | ✅ | — | ✅ |

### messaging

| Permission | All authenticated users | super_admin |
|---|---|---|
| `messaging:send` | ✅ | ✅ |
| `messaging:read` | own only | ✅ |

### notification

| Permission | organizer | co_organizer | super_admin |
|---|---|---|---|
| `notification:send` | ✅ | ✅ | ✅ |
| `notification:send_sms` | ✅ (Pro+) | ✅ (Pro+) | ✅ |

### sponsor

| Permission | sponsor | organizer | co_organizer | super_admin |
|---|---|---|---|---|
| `sponsor:manage_booth` | ✅ | ✅ | ✅ | ✅ |
| `sponsor:collect_leads` | ✅ | — | — | ✅ |
| `sponsor:view_leads` | ✅ | ✅ | ✅ | ✅ |

### speaker

| Permission | speaker | organizer | co_organizer | super_admin |
|---|---|---|---|---|
| `speaker:manage_own_profile` | ✅ | — | — | ✅ |
| `speaker:view_schedule` | ✅ | ✅ | ✅ | ✅ |

### venue

| Permission | venue_manager | organizer | super_admin |
|---|---|---|---|
| `venue:create` | ✅ | ✅ | ✅ |
| `venue:manage_own` | ✅ | — | ✅ |
| `venue:approve` | — | — | ✅ |
| `venue:suspend` | — | — | ✅ |

### plan

| Permission | super_admin |
|---|---|
| `plan:manage` | ✅ |
| `plan:read` | ✅ |

### platform

| Permission | super_admin |
|---|---|
| `platform:manage` | ✅ (implies all) |

---

## Implementation

```typescript
// packages/shared-types/src/permissions.types.ts

export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  participant: ['registration:create', 'registration:read_own', 'registration:cancel_own',
                'badge:view_own', 'feed:read', 'feed:create_post', 'messaging:send', ...],
  organizer: ['event:*', 'registration:read_all', 'registration:approve', 'registration:export',
              'badge:generate', 'checkin:*', 'organization:*', 'analytics:read', ...],
  staff: ['checkin:scan', 'checkin:manual', 'registration:read_all', 'checkin:sync_offline'],
  speaker: ['event:read', 'speaker:manage_own_profile', 'feed:create_post', 'messaging:send'],
  sponsor: ['sponsor:manage_booth', 'sponsor:collect_leads', 'event:read'],
  co_organizer: [...organizer_permissions_minus_org_management],
  venue_manager: ['venue:create', 'venue:manage_own', 'event:read'],
  super_admin: ['platform:manage'],
};

export function resolvePermissions(roles: SystemRole[]): Set<Permission> {
  if (roles.includes('super_admin')) return new Set(['*']); // implies all
  const perms = new Set<Permission>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) {
      perms.add(perm);
    }
  }
  return perms;
}
```
