---
title: Registrations API
status: shipped
last_updated: 2026-04-25
---

# Registrations API

> **Status: shipped**

Base path: `/v1/registrations`

---

## Register for an event

```
POST /v1/registrations
```

**Auth:** Required  
**Permission:** `registration:create`  
**Requires:** Email verified (for paid tickets)  
**Plan limit:** `maxParticipantsPerEvent` checked (skipped if event has started)

**Request body:**

```typescript
{
  eventId: string;
  ticketTypeId: string;
  promoCode?: string;              // optional discount code
  // Participant fields (pre-filled from user profile if not provided)
  participantName?: string;
  participantEmail?: string;
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "reg_xyz",
    "status": "confirmed",          // or "waitlisted" if requiresApproval=true or "pending_payment" if paid
    "qrCodeValue": "...",
    "eventTitle": "Hackathon Dakar 2026",
    "ticketTypeName": "Entrée générale"
  }
}
```

**Error cases:**

| Code | Meaning |
|---|---|
| `EVENT_NOT_FOUND` | Event does not exist or is not published |
| `EVENT_CANCELLED` | Cannot register for a cancelled event |
| `TICKET_TYPE_NOT_FOUND` | Ticket type ID is invalid |
| `TICKET_SOLD_OUT` | Ticket type capacity is exhausted |
| `EVENT_CAPACITY_FULL` | Event maxAttendees reached |
| `PLAN_LIMIT_EXCEEDED` | Org's maxParticipantsPerEvent limit reached |
| `ALREADY_REGISTERED` | User is already registered for this event |
| `EMAIL_NOT_VERIFIED` | Paid ticket requires email verification |
| `PROMO_CODE_INVALID` | Promo code not found, expired, or exhausted |

---

## Get my registrations

```
GET /v1/registrations/me
```

**Auth:** Required  
**Permission:** `registration:read_own`

**Query parameters:** `page`, `limit`, `status`, `eventId`

---

## Get event registrations (organizer view)

```
GET /v1/registrations/event/:eventId
```

**Auth:** Required  
**Permission:** `registration:read_all` + org membership

Returns all registrations for the event, including participant names, emails, status, and check-in status.

**Query parameters:** `page`, `limit`, `status`, `search` (name/email)

---

## Cancel registration

```
DELETE /v1/registrations/:registrationId
```

**Auth:** Required  
**Permission:** `registration:cancel_own` (own) or `registration:cancel_any` (organizer)

Soft-cancels the registration (`status → cancelled`). If the event has a waitlist, the Cloud Functions trigger promotes the next waitlisted participant.

---

## Approve registration

```
PATCH /v1/registrations/:registrationId/approve
```

**Auth:** Required  
**Permission:** `registration:approve` + org membership

Transitions `pending` or `waitlisted` → `confirmed`. Triggers badge generation.

---

## Reject registration

```
PATCH /v1/registrations/:registrationId/reject
```

**Auth:** Required  
**Permission:** `registration:approve` + org membership

Transitions `pending` or `waitlisted` → `cancelled`.

**Request body:**
```typescript
{ reason?: string }
```

---

## Export registrations to CSV

```
GET /v1/registrations/event/:eventId/export
```

**Auth:** Required  
**Permission:** `registration:export` + org membership  
**Plan limit:** Requires `csvExport` feature flag (Starter plan+)

**Response:** `Content-Type: text/csv` with filename `registrations-{eventSlug}-{date}.csv`

**CSV columns:** `participantName`, `participantEmail`, `ticketType`, `status`, `registeredAt`, `checkedInAt`, `promoCode`
