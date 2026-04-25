---
title: Badges API
status: shipped
last_updated: 2026-04-25
---

# Badges API

> **Status: shipped**

Base path: `/v1/badges`

Badges are generated automatically by Cloud Functions when a registration is confirmed. You only need to call these endpoints to query, download, or trigger bulk generation.

---

## Get my badges

```
GET /v1/badges/me
```

**Auth:** Required  
**Permission:** `badge:view_own`

Returns the authenticated user's badges across all events.

---

## Get event badges (organizer)

```
GET /v1/badges/event/:eventId
```

**Auth:** Required  
**Permission:** `badge:view_all` + org membership

Returns all badges for the event, including generation status.

**Query parameters:** `status` (`pending` | `generated` | `failed`)

---

## Trigger badge generation

```
POST /v1/badges/event/:eventId/generate
```

**Auth:** Required  
**Permission:** `badge:generate` + org membership  
**Plan limit:** `customBadges` feature flag required for custom templates (Starter+)

Triggers asynchronous badge generation. For a single registration:

```typescript
{ registrationId: string; templateId?: string }
```

For bulk (all confirmed registrations):

```typescript
{ all: true; templateId?: string }
```

**Response:**

```json
{
  "success": true,
  "data": {
    "queued": 87,
    "jobId": "job_abc"
  }
}
```

Badge generation is handled by the `onBadgeCreated` Cloud Functions trigger. Status changes to `generated` when the PDF is ready (typically 5–30 seconds per badge).

---

## Download badge PDF

```
GET /v1/badges/:badgeId/download
```

**Auth:** Required  
**Permission:** `badge:view_own` (own badge) or `badge:view_all` (organizer)

Redirects to a signed Cloud Storage URL for the badge PDF. The signed URL expires in 15 minutes.

---

## Badge template CRUD (organizer)

```
GET    /v1/badge-templates?orgId=:orgId
POST   /v1/badge-templates
PATCH  /v1/badge-templates/:templateId
DELETE /v1/badge-templates/:templateId
```

**Auth:** Required  
**Permission:** `badge:generate` + org membership  
**Plan limit:** `customBadges` feature (Starter+)

**Template body:**

```typescript
{
  organizationId: string;
  name: string;
  backgroundColor: string;         // hex color
  textColor: string;
  logoUrl?: string;
  showQrCode: boolean;
  showName: boolean;
  showOrganization: boolean;
  showRole: boolean;
  showPhoto: boolean;
}
```
