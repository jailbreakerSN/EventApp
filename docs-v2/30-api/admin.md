# Admin API

> **Status: shipped** — All admin endpoints require `super_admin` role.

Base path: `/v1/admin`

All endpoints in this section require `platform:manage` permission, which is only held by `super_admin`.

---

## User management

### Set user roles

```
POST /v1/admin/users/:userId/roles
```

Updates a user's system roles. Propagates to Firebase Auth custom claims.

**Request body:**
```typescript
{ roles: SystemRole[] }
```

### Suspend user

```
POST /v1/admin/users/:userId/suspend
```

Sets `user.isActive = false`. The user's Firebase Auth account is disabled.

### Reactivate user

```
POST /v1/admin/users/:userId/reactivate
```

---

## Organization management

### Verify organization (KYB)

```
POST /v1/admin/organizations/:orgId/verify
```

Sets `organization.isVerified = true`. Emits `organization.verified` audit event.

### Suspend organization

```
POST /v1/admin/organizations/:orgId/suspend
```

Suspends the org — all associated events are unpublished and users lose API access.

### Reactivate organization

```
POST /v1/admin/organizations/:orgId/reactivate
```

---

## Plan catalog management

### List all plans

```
GET /v1/admin/plans
```

Returns all plans including archived ones (unlike the public `/v1/plans` endpoint).

### Create plan

```
POST /v1/admin/plans
```

**Request body:**

```typescript
{
  key: string;                     // e.g. 'startup_promo', must be unique
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  priceXof: number;
  pricingModel: 'free' | 'fixed' | 'custom' | 'metered';
  limits: {
    maxEvents: number;             // -1 = unlimited
    maxParticipantsPerEvent: number;
    maxMembers: number;
  };
  features: PlanFeatures;
  isPublic: boolean;
}
```

### Update plan

```
PATCH /v1/admin/plans/:planId
```

After updating a plan, `effectiveLimits` is refreshed for all orgs on that plan (via domain event listener — async).

---

## Platform analytics

```
GET /v1/admin/analytics
```

Returns platform-wide stats: total users, organizations, events, registrations, revenue.

---

## Audit log

```
GET /v1/admin/audit
```

**Query parameters:** `organizationId`, `eventId`, `actorId`, `action`, `from`, `to`, `page`, `limit`
