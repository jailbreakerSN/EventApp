# Venues API

> **Status: shipped**

Base path: `/v1/venues`

---

## List org venues

```
GET /v1/venues?orgId=:orgId
```

**Auth:** Required  
**Permission:** `organization:read` + org membership

---

## Create venue

```
POST /v1/venues
```

**Auth:** Required  
**Permission:** `venue:create`

New venues have `status: 'pending'` — they must be approved by a super-admin before organizers can select them for events.

**Request body:**

```typescript
{
  organizationId: string;          // hosting org
  name: string;
  address: string;
  city: string;
  country: string;
  capacity: number;
  coordinates?: { lat: number; lng: number };
  photoUrl?: string;
  description?: string;
}
```

---

## Update venue

```
PATCH /v1/venues/:venueId
```

**Auth:** Required  
**Permission:** `venue:manage_own` + must be from the hosting org

---

## Approve venue (super-admin)

```
POST /v1/admin/venues/:venueId/approve
```

**Auth:** Required  
**Permission:** `venue:approve` (super_admin only)

Approves a venue listing. Triggers an approval email to the hosting org owner via Resend.

---

## Suspend venue (super-admin)

```
POST /v1/admin/venues/:venueId/suspend
```

**Auth:** Required  
**Permission:** `venue:suspend` (super_admin only)
