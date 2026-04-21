# API Reference

> **Status: shipped** — Fastify REST API running on Cloud Run. All routes are versioned under `/v1/`.

**Base URL:**
- Local: `http://localhost:3000`
- Staging: `https://teranga-api-<hash>-ew.a.run.app`
- Production: TBD (Wave 10)

---

## Authentication

Every non-public endpoint requires a Firebase ID token in the `Authorization` header:

```
Authorization: Bearer <firebase_id_token>
```

Obtain an ID token with the Firebase Auth SDK:

```typescript
const token = await firebase.auth().currentUser.getIdToken();
```

The API verifies the token via `firebase-admin.auth().verifyIdToken()`. If the token is invalid or expired, the response is:

```json
{ "success": false, "error": { "code": "UNAUTHORIZED", "message": "Invalid or expired token" } }
```

**Public endpoints** (no token required): `GET /health`, `GET /ready`, `GET /v1/events` (published events only), `GET /v1/events/by-slug/:slug` (published events only).

---

## Request format

All mutation requests (`POST`, `PATCH`, `PUT`) must send `Content-Type: application/json`. Requests with an incorrect Content-Type receive `415 Unsupported Media Type`.

Body size limit: **1 MB**.

---

## Response envelope

All responses follow a consistent envelope:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Success (list):**
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 87,
    "hasMore": true
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

---

## Common error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body/params/query failed Zod schema validation |
| 401 | `UNAUTHORIZED` | Missing or invalid Firebase ID token |
| 402 | `PLAN_LIMIT_EXCEEDED` | Operation blocked by freemium plan limit |
| 403 | `FORBIDDEN` | Authenticated but insufficient permissions |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate resource (e.g., slug already taken) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Non-JSON Content-Type on mutation |
| 422 | `UNPROCESSABLE_ENTITY` | Request is valid but business rules prevent it |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests (100 per 60 seconds per token) |
| 500 | `INTERNAL_ERROR` | Unexpected server error (logged to Sentry) |

---

## Pagination

All list endpoints support:

```
?page=1&limit=20&orderBy=createdAt&orderDir=desc
```

| Parameter | Default | Max |
|---|---|---|
| `page` | 1 | — |
| `limit` | 20 | 100 |
| `orderBy` | `createdAt` | varies by endpoint |
| `orderDir` | `desc` | `asc` or `desc` |

---

## Rate limiting

100 requests per 60-second window per authenticated user (keyed by SHA256 hash of Authorization header). Unauthenticated requests are keyed by IP.

On limit: HTTP 429 + `Retry-After` header with seconds until reset.

---

## Swagger / OpenAPI

Swagger UI is available at:
- Local: http://localhost:3000/documentation
- Staging: `https://<api-url>/documentation`

---

## Route index

| Resource | Base path | Docs |
|---|---|---|
| Events | `/v1/events` | [events.md](./events.md) |
| Registrations | `/v1/registrations` | [registrations.md](./registrations.md) |
| Check-ins | `/v1/events/:eventId/checkin` | [checkins.md](./checkins.md) |
| Badges | `/v1/badges` | [badges.md](./badges.md) |
| Organizations | `/v1/organizations` | [organizations.md](./organizations.md) |
| Subscriptions | `/v1/organizations/:orgId/subscription` | [subscriptions.md](./subscriptions.md) |
| Payments | `/v1/payments` | [payments.md](./payments.md) |
| Notifications | `/v1/notifications` | [notifications.md](./notifications.md) |
| Feed | `/v1/events/:eventId/feed` | [feed.md](./feed.md) |
| Messaging | `/v1/conversations` | [messaging.md](./messaging.md) |
| Venues | `/v1/venues` | [venues.md](./venues.md) |
| Admin | `/v1/admin` | [admin.md](./admin.md) |
| Health | `/health`, `/ready` | This file |

---

## Health endpoints

```
GET /health
```
Liveness probe. Always returns 200 while the process is alive.

```json
{ "status": "ok", "timestamp": "2026-04-21T10:00:00Z" }
```

```
GET /ready
```
Readiness probe. Returns 200 when Firestore and Auth are reachable.

```json
{ "status": "ready", "firestore": true, "auth": true }
```

Returns 503 if any dependency is unreachable (e.g., Firestore cold start).
