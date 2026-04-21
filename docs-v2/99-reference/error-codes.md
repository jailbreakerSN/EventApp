# API Error Codes Reference

> All error responses from the Teranga API follow a consistent envelope. This document lists every error code, its HTTP status, the typed error class that produces it, and when each code is emitted.

---

## Response Envelope

Every error response — regardless of HTTP status — has this shape:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Event not found",
    "details": {}
  }
}
```

| Field | Type | Description |
|---|---|---|
| `success` | `false` | Always `false` for error responses |
| `error.code` | `ErrorCode` | Machine-readable code from the table below |
| `error.message` | `string` | Human-readable description (may be in French) |
| `error.details` | `object?` | Optional structured details (field errors, limits, etc.) |

---

## Error Code Table

| Code | HTTP Status | Error Class | Meaning |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | `UnauthorizedError` | No valid Firebase ID token in `Authorization` header, token expired, or token revoked |
| `FORBIDDEN` | 403 | `ForbiddenError` | Authenticated but insufficient permission for this operation |
| `NOT_FOUND` | 404 | `NotFoundError` | The requested resource does not exist (or is not visible to this user) |
| `VALIDATION_ERROR` | 400 | `ValidationError` | Request body, params, or query failed Zod schema validation |
| `CONFLICT` | 409 | `ConflictError` | Duplicate operation — e.g. registering twice for the same event |
| `EVENT_FULL` | 409 | `EventFullError` / `ZoneFullError` | Event or access zone has reached its participant capacity |
| `REGISTRATION_CLOSED` | 400 | `RegistrationClosedError` | Registration is not open (event not published, cancelled, or window closed) |
| `QR_INVALID` | 400 | `QrInvalidError` | QR payload is malformed, signature is invalid, or HMAC verification failed |
| `QR_ALREADY_USED` | 409 | `QrAlreadyUsedError` | QR code was already scanned and the registration is already checked in |
| `QR_EXPIRED` | 410 | `QrExpiredError` | QR code's `notAfter` timestamp has passed (with ±2h clock-skew grace) |
| `QR_NOT_YET_VALID` | 425 | `QrNotYetValidError` | QR code's `notBefore` timestamp is in the future |
| `QUOTA_EXCEEDED` | 403 | `QuotaExceededError` | Rate limit exceeded on a specific resource (distinct from plan limits) |
| `ORGANIZATION_PLAN_LIMIT` | 403 | `PlanLimitError` | The organization's current plan does not allow this operation |
| `EMAIL_NOT_VERIFIED` | 403 | `EmailNotVerifiedError` | Firebase Auth email is not verified; required for this action |
| `INTERNAL_ERROR` | 500 | (catch-all) | Unexpected server error — check Sentry for details |

---

## Detailed Code Descriptions

### `UNAUTHORIZED` (401)

Emitted by: `authenticate` middleware

**When:**
- No `Authorization: Bearer <token>` header
- Token is expired (Firebase ID tokens expire after 1 hour — client must refresh)
- Token is revoked (user session invalidated by admin)
- Token signature is invalid

**Client action:** Refresh the Firebase ID token with `getIdToken(true)` and retry once.

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentification requise"
  }
}
```

---

### `FORBIDDEN` (403)

Emitted by: `requirePermission` middleware, `BaseService.requirePermission()`, `BaseService.requireOrganizationAccess()`

**When:**
- User does not have the required permission (e.g., `event:create` requires organizer)
- User is trying to access data from an organization they don't belong to
- Trying to perform an organizer action as a participant

**Client action:** Do not retry. Show an "access denied" message.

---

### `NOT_FOUND` (404)

Emitted by: `NotFoundError` thrown in services

**When:**
- Resource ID does not exist in Firestore
- Resource exists but belongs to another organization (returns 404, not 403, to prevent enumeration)
- Soft-deleted resource (status: `archived`/`cancelled`) accessed via a "find active" query

---

### `VALIDATION_ERROR` (400)

Emitted by: `validate` middleware (Zod schema validation)

**When:** Request body, path params, or query string fail schema validation.

**The `details` field contains field-level errors:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "fieldErrors": {
        "title": ["Required"],
        "startDate": ["Invalid date format — use ISO 8601"]
      }
    }
  }
}
```

---

### `CONFLICT` (409)

Emitted by: `ConflictError`

**When:**
- Participant tries to register for an event they are already registered for
- Creating a resource that would violate a unique constraint (e.g., slug)
- Concurrent modification detected

---

### `EVENT_FULL` (409)

Emitted by: `EventFullError`, `ZoneFullError`

**When:**
- `registration.registeredCount >= ticketType.maxCapacity`
- `checkin.zoneCount >= accessZone.capacity`

**Grace period:** After `event.startDate`, participant limit enforcement is suspended for registrations (never block a live event). Zone capacity enforcement continues during the event.

**The `details` field:**
```json
{
  "error": {
    "code": "EVENT_FULL",
    "message": "Cet événement est complet",
    "details": {
      "capacity": 200,
      "registered": 200
    }
  }
}
```

---

### `REGISTRATION_CLOSED` (400)

Emitted by: `RegistrationClosedError`

**When:**
- Event `status` is not `published`
- Current time is before `registrationStartDate` or after `registrationEndDate` (if set)
- Event `status` is `cancelled` or `completed`

---

### `QR_INVALID` (400)

Emitted by: `QrInvalidError`

**When:**
- QR string does not match expected format (4–6 colon-separated parts for v1–v4)
- HMAC-SHA256 signature does not match (payload was tampered)
- `crypto.timingSafeEqual` comparison failed
- Required parts (registrationId, eventId, userId) are missing or malformed

---

### `QR_ALREADY_USED` (409)

Emitted by: `QrAlreadyUsedError`

**When:**
- `registration.status === "checked_in"` and scan is attempted again
- Check-in lock document already exists (concurrent scan race condition)

**Note:** The check-in lock is a short-lived Firestore transaction document. A `QR_ALREADY_USED` on the very first scan may indicate a clock-sync issue between scanner devices.

---

### `QR_EXPIRED` (410)

Emitted by: `QrExpiredError`

**When:**
- QR v3/v4: `now > notAfter + 2h` (the 2h is clock-skew grace)
- QR v1/v2: `now > event.endDate + 6h` (backfilled window)

**HTTP 410 Gone** signals that the QR code was once valid but is no longer.

---

### `QR_NOT_YET_VALID` (425)

Emitted by: `QrNotYetValidError`

**When:**
- QR v3/v4: `now < notBefore - 2h`
- QR v1/v2: `now < event.startDate - 24h`

**HTTP 425 Too Early** signals that the QR code is valid but should not be scanned yet.

---

### `QUOTA_EXCEEDED` (403)

Emitted by: `QuotaExceededError`

**When:**
- Rate-limit threshold reached (Fastify rate-limiter)
- API key quota exhausted (future: per-API-key limits for Enterprise webhooks)

---

### `ORGANIZATION_PLAN_LIMIT` (403)

Emitted by: `PlanLimitError`

**When:**
- Creating an event when `activeEvents >= plan.maxEvents`
- Registering when `registeredCount >= plan.maxParticipantsPerEvent` (before event start)
- Creating a paid ticket when `!plan.features.paidTickets`
- Inviting a member when `members >= plan.maxMembers`
- Accessing a feature gated behind a higher plan

**The `details` field:**
```json
{
  "error": {
    "code": "ORGANIZATION_PLAN_LIMIT",
    "message": "Limite du plan atteinte",
    "details": {
      "resource": "events",
      "current": 3,
      "limit": 3,
      "plan": "free",
      "requiredPlan": "starter"
    }
  }
}
```

---

### `EMAIL_NOT_VERIFIED` (403)

Emitted by: `EmailNotVerifiedError`

**When:**
- User tries to create an organization or publish an event without a verified Firebase Auth email address

---

### `INTERNAL_ERROR` (500)

Emitted by: global Fastify error handler for any uncaught exception

**When:**
- Unhandled exception in a service or repository
- Firestore connection error
- Third-party API failure (Resend, Africa's Talking, payment providers)

**Client action:** Retry with exponential backoff (max 3 attempts). If persists, surface to user as a generic error.

**Observability:** Every 500 is automatically reported to Sentry with full stack trace and request context (requestId, userId, method, path). Search Sentry by `requestId` from the response.

---

## TypeScript Types

```typescript
// packages/shared-types/src/api.types.ts

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EVENT_FULL: 'EVENT_FULL',
  REGISTRATION_CLOSED: 'REGISTRATION_CLOSED',
  QR_INVALID: 'QR_INVALID',
  QR_ALREADY_USED: 'QR_ALREADY_USED',
  QR_EXPIRED: 'QR_EXPIRED',
  QR_NOT_YET_VALID: 'QR_NOT_YET_VALID',
  ORGANIZATION_PLAN_LIMIT: 'ORGANIZATION_PLAN_LIMIT',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiError;
}
```

---

## Client-Side Error Handling Pattern

```typescript
// apps/web-backoffice/src/lib/api-client.ts

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    // Refresh token and retry once
    const token = await getIdToken(true);
    // ... retry logic
  }

  if (!response.ok) {
    const body: ApiErrorResponse = await response.json();
    throw new ApiClientError(body.error.code, body.error.message, body.error.details);
  }

  const body = await response.json();
  return body.data;
}
```
