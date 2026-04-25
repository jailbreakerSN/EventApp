---
title: Events API
status: shipped
last_updated: 2026-04-25
---

# Events API

> **Status: shipped**

Base path: `/v1/events`

---

## List published events (public)

```
GET /v1/events
```

**Auth:** Optional  
**Permission:** None (public endpoint)

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search on title and description |
| `category` | string | Filter by category |
| `city` | string | Filter by city |
| `format` | string | `in_person` \| `online` \| `hybrid` |
| `isFeatured` | boolean | Return featured events only |
| `page` | number | Default: 1 |
| `limit` | number | Default: 20, max: 50 |

**Response:** `{ success: true, data: Event[], pagination: { ... } }`

---

## List org events

```
GET /v1/events/org/:orgId
```

**Auth:** Required  
**Permission:** `event:read` + org membership

Returns all events for the org in all statuses (draft, published, cancelled, etc.).

**Query parameters:** Same as above, plus `status` to filter by `EventStatus`.

---

## Get event by ID

```
GET /v1/events/:eventId
```

**Auth:** Required for non-public or non-published events  
**Permission:** Public if `status=published && isPublic=true`; otherwise requires org membership

---

## Get event by slug (public)

```
GET /v1/events/by-slug/:slug
```

**Auth:** Optional  
**Permission:** None (published + public only)

---

## Create event

```
POST /v1/events
```

**Auth:** Required  
**Permission:** `event:create`  
**Plan limit:** `maxEvents` checked against active event count

**Request body:**

```typescript
{
  organizationId: string;          // required
  title: string;                   // min 3, max 200 chars
  description: string;
  category: EventCategory;
  format: 'in_person' | 'online' | 'hybrid';
  location: {
    name: string;
    address: string;
    city: string;
    country: string;
    coordinates?: { lat: number; lng: number };
    streamUrl?: string;
  };
  startDate: string;               // ISO 8601
  endDate: string;
  timezone: string;                // IANA timezone
  isPublic?: boolean;              // default: true
  requiresApproval?: boolean;      // default: false
  maxAttendees?: number;
  venueId?: string;
}
```

**Response:** `201 Created` + created event

---

## Update event

```
PATCH /v1/events/:eventId
```

**Auth:** Required  
**Permission:** `event:update` + org membership

Partial update — only send fields you want to change. Immutable fields (`organizationId`, `createdBy`, `slug`, `qrKid`) are rejected with 422.

---

## Publish / unpublish

```
POST /v1/events/:eventId/publish
POST /v1/events/:eventId/unpublish
```

**Auth:** Required  
**Permission:** `event:publish` + org membership

Publishes (or unpublishes) an event. Published events are visible in the public discovery feed.

---

## Clone event

```
POST /v1/events/:eventId/clone
```

**Auth:** Required  
**Permission:** `event:clone` + org membership  
**Plan limit:** `maxEvents` checked (cloned event counts against the limit)

**Request body:**

```typescript
{
  title?: string;                  // default: "{original title} (copie)"
  startDate: string;               // new start date, required
  endDate: string;
  copyTicketTypes?: boolean;       // default: true
  copyAccessZones?: boolean;       // default: true
}
```

---

## Ticket types

```
POST   /v1/events/:eventId/ticket-types
PATCH  /v1/events/:eventId/ticket-types/:ticketTypeId
DELETE /v1/events/:eventId/ticket-types/:ticketTypeId
```

**Auth:** Required  
**Permission:** `event:update` + org membership  
**Plan limit (POST):** `price > 0` requires `paidTickets` feature flag (Pro plan+)

**Create body:**
```typescript
{
  name: string;
  price: number;                   // XOF, 0 = free
  totalQuantity?: number;          // null = unlimited
  saleStartDate?: string;
  saleEndDate?: string;
}
```

---

## Access zones

```
POST   /v1/events/:eventId/access-zones
PATCH  /v1/events/:eventId/access-zones/:zoneId
DELETE /v1/events/:eventId/access-zones/:zoneId
```

**Auth:** Required  
**Permission:** `event:update` + org membership

**Create body:**
```typescript
{
  name: string;
  color: string;                   // hex color
  allowedTicketTypeIds: string[];
  capacity?: number;               // null = unlimited
}
```

---

## Set scan policy

```
POST /v1/events/:eventId/scan-policy
```

**Auth:** Required  
**Permission:** `event:update` + org membership  
**Plan limit:** `multi_day` and `multi_zone` require `advancedAnalytics` (Pro plan+)

**Request body:**
```typescript
{ policy: 'single' | 'multi_day' | 'multi_zone' }
```

---

## Rotate QR signing key

```
POST /v1/events/:eventId/qr-key/rotate
```

**Auth:** Required  
**Permission:** `event:update` + org membership (owner or admin)

Mints a new `qrKid` for the event. Old kid is kept in `qrKidHistory` — previously issued badges continue to work during the overlap window. New badges use the new key.

No request body required.
