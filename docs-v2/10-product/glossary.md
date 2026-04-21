# Glossary

Domain-specific terms used throughout the Teranga codebase and documentation.

---

## A

**Access zone** (`AccessZone`)
A named sub-area of a venue (e.g., VIP lounge, Stage A, Workshop Room 2). Events can have multiple access zones, each with a capacity limit. Registrations can be restricted to specific zones based on their ticket type. Used by the scanner to enforce zone-level capacity.

**Audit action** (`AuditAction`)
One of 83 enumerated strings that identify a specific business event for audit purposes (e.g., `registration.created`, `event.published`, `subscription.upgraded`). Written to the `audit_logs` collection via the domain event bus. Full list: [Audit actions reference](../20-architecture/reference/audit-actions.md).

**Africa's Talking**
The SMS API provider used for Teranga SMS notifications. Specialized for African markets (Senegal +221). Requires the `smsNotifications` feature flag (Pro plan+).

---

## B

**Badge** (`Badge`)
A Firestore document representing a printable/downloadable attendee credential. Contains a PDF URL (stored in Cloud Storage), a signed `qrCodeValue`, and validity window (`notBefore`, `notAfter`). Generated asynchronously by a Cloud Functions trigger when a registration is confirmed.

**BaseRepository**
Generic Firestore CRUD class that all repositories extend. Provides `findById`, `findAll`, `create`, `update`, `delete` (soft-delete only) with TypeScript generics.

**BaseService**
Abstract service class providing shared `requirePermission()`, `requireOrganizationAccess()`, `requirePlanFeature()`, and `checkPlanLimit()` helpers. All domain services extend this.

---

## C

**co_organizer**
A system role scoped to a single event. Has the same capabilities as an organizer for that event, but no access to the organization's settings or other events.

**Custom claims**
Firebase Auth JWT extension fields set by the API via `firebase-admin.auth().setCustomUserClaims()`. Carry `roles: string[]`, `organizationId: string | null`, and `orgRole` for fast permission resolution without a Firestore read on every request.

---

## D

**Domain event**
An in-process event emitted by the API event bus (`eventBus.emit(...)`) after a successful mutation. Listeners handle side effects (audit logging, push notifications, plan denormalization) without coupling the service to those concerns. Fire-and-forget — never blocks the HTTP response.

---

## E

**effectiveLimits / effectiveFeatures**
Denormalized fields on the `organizations` Firestore document that store the org's resolved plan limits and feature flags. Computed by `PlanService.getEffectiveForOrganization()` and cached here to avoid extra reads. Updated whenever the subscription changes. Used by services as the fast path for plan enforcement. (Legacy fallback: hardcoded `PLAN_LIMITS` constant during the Phase 2–6 migration.)

**EventBus**
The in-process pub/sub event bus in `apps/api/src/events/`. Emits typed domain events (e.g., `registration.created`, `checkin.completed`). Listeners are registered at startup. Error isolation: a listener error never propagates to the emitter.

---

## H

**HKDF** (HMAC-based Key Derivation Function)
The key derivation algorithm used in QR v4 signing. Given the master secret (`QR_MASTER_SECRET`) and an event-specific input (event ID + `qrKid`), HKDF-SHA256 derives a unique signing key for each event. This means a badge from Event A cannot be used to check in to Event B.

**HMAC-SHA256**
The signing algorithm for QR codes. Takes the derived key and signs the QR payload (registration ID, event ID, notBefore, notAfter). Verified at scan time using `crypto.timingSafeEqual` to prevent timing attacks.

---

## K

**kid** (Key ID, `qrKid`)
A short random identifier (8 chars, base36) assigned to each event at creation time. Used as part of the HKDF derivation input so each event has a unique signing key. Stored on the event document. Can be rotated (old kid kept in `qrKidHistory` for the overlap window). Immutable once set — enforced by Firestore rules.

---

## N

**notBefore / notAfter**
Unix timestamps (milliseconds, stored as base36 strings in the QR payload) defining the validity window of a badge. The scanner rejects QRs where `now < notBefore − 2h` or `now > notAfter + 2h`. The 2-hour grace handles clock skew between scanner device and server. Default window: `event.startDate − 24h` to `event.endDate + 6h`.

---

## O

**OrgMemberRole**
The role a user holds within an organization (distinct from the system-level `SystemRole`). Values: `owner` (full control, can delete org), `admin` (manage events + members), `member` (own events + analytics), `viewer` (read-only). Stored on the `OrgMember` record and mirrored in `user.orgRole` for fast JWT-based checks.

**Offline sync**
The feature that allows staff to download a complete snapshot of an event's registrations to a mobile device before entering a low-connectivity venue. The snapshot is optionally encrypted with ECDH-X25519/AES-256-GCM. Scans queue locally and are bulk-uploaded when connectivity returns.

---

## P

**Plan catalog**
The `plans` Firestore collection, managed by super-admins via `/v1/admin/plans`. Contains the authoritative definition of each plan's limits and features. Replaces the hardcoded `PLAN_LIMITS` constant (Phase 3 onwards).

**PlanLimitError**
A typed API error thrown when an operation would exceed a plan limit. Returns HTTP 402 with code `PLAN_LIMIT_EXCEEDED` and details including `resource`, `current`, `limit`, and `requiredPlan`.

---

## Q

**QR v4**
The current QR signing scheme. Uses HKDF-SHA256 to derive a unique per-event key from the master secret and the event's `qrKid`. Signs the full payload (registration ID, event ID, notBefore, notAfter) with HMAC-SHA256. Replaces v3 (which used a global secret without key derivation) and v1/v2 legacy formats.

---

## R

**RequestContext**
An `AsyncLocalStorage`-based container holding the current request's `requestId`, `userId`, `organizationId`, and start time. Set by middleware, accessible anywhere in the async call chain via `getRequestContext()` — no need to thread context through function parameters.

---

## S

**ScanPolicy**
The rule governing how many times a registration's QR can be scanned at an event. Three values: `single` (once, ever — default), `multi_day` (once per calendar day), `multi_zone` (once per access zone). `multi_day` and `multi_zone` require the `advancedAnalytics` feature flag (Pro plan+).

**Soft delete**
The platform never hard-deletes records. Instead, `status` is set to `archived`, `cancelled`, or a boolean `deletedAt` timestamp is set. This preserves history and audit trail.

---

## T

**Teranga**
Wolof (Senegalese national language) for *hospitality*. The founding concept of the platform.

---

## W

**Wave**
A scoped delivery increment in the platform roadmap. Each wave targets a specific capability area (e.g., Wave 2 = check-in, Wave 6 = payments). Waves are not strictly sequential — some features ship across multiple waves.

**XOF**
ISO 4217 currency code for the CFA Franc BCEAO, used across WAEMU countries including Senegal, Côte d'Ivoire, Mali, Burkina Faso, Guinea-Bissau, Niger, Togo, and Benin. The platform's default currency.
