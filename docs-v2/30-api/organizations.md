# Organizations API

> **Status: shipped**

Base path: `/v1/organizations`

---

## Create organization

```
POST /v1/organizations
```

**Auth:** Required  
**Permission:** `organization:create`

The authenticated user becomes the organization owner. A `free` plan subscription is created automatically.

**Request body:**

```typescript
{
  name: string;
  description?: string;
  website?: string;
  logoUrl?: string;
}
```

---

## Get organization

```
GET /v1/organizations/:orgId
```

**Auth:** Required  
**Permission:** `organization:read` + org membership (or super_admin)

---

## Update organization

```
PATCH /v1/organizations/:orgId
```

**Auth:** Required  
**Permission:** `organization:update` + org membership (admin or owner)

`slug` is immutable after creation.

---

## List members

```
GET /v1/organizations/:orgId/members
```

**Auth:** Required  
**Permission:** `organization:read` + org membership

---

## Add member

```
POST /v1/organizations/:orgId/members
```

**Auth:** Required  
**Permission:** `organization:manage_members`  
**Plan limit:** `maxMembers` checked

**Request body:**

```typescript
{
  userId: string;
  role: 'admin' | 'member' | 'viewer';   // cannot assign 'owner' via this endpoint
}
```

---

## Remove member

```
DELETE /v1/organizations/:orgId/members/:userId
```

**Auth:** Required  
**Permission:** `organization:manage_members`

Cannot remove the owner. The owner must transfer ownership first.

---

## Invite member by email

```
POST /v1/organizations/:orgId/invites
```

**Auth:** Required  
**Permission:** `organization:manage_members`  
**Plan limit:** `maxMembers` checked at accept time

Sends an invitation email via Resend. The invite token expires in 7 days.

**Request body:**

```typescript
{
  email: string;
  role: 'admin' | 'member' | 'viewer';
}
```

---

## Accept invite

```
GET /v1/organizations/invites/:inviteToken
```

**Auth:** Required (the user accepting must be signed in)  
**Permission:** None

Validates token, checks expiry, adds user to organization.

---

## Get analytics

```
GET /v1/organizations/:orgId/analytics
```

**Auth:** Required  
**Permission:** `analytics:read` + org membership  
**Plan limit:** Requires `advancedAnalytics` (Pro+) for the full chart data

**Query parameters:** `timeframe=7d|30d|90d|12m|all`

**Response:**

```json
{
  "success": true,
  "data": {
    "totalEvents": 4,
    "publishedEvents": 2,
    "totalRegistrations": 312,
    "totalCheckins": 267,
    "totalRevenueXof": 450000,
    "registrationsByDay": [ ... ],
    "checkinsByDay": [ ... ],
    "topEvents": [ ... ],
    "byCategory": [ ... ],
    "byTicketType": [ ... ]
  }
}
```
