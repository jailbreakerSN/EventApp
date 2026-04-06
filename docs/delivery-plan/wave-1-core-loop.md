# Wave 1: Core Loop — Create Event, Register, Generate Badge

**Status:** `completed`
**Estimated effort:** 2 weeks
**Goal:** Complete the primary user journey: organizer creates event → participant registers → badge is generated.

## Why This Wave Matters

This is the **minimum viable product**. Without create → register → badge, there is no Teranga. Every subsequent wave extends this core loop.

---

## Progress Summary

| Layer | Status | Tests |
|-------|--------|-------|
| API (Fastify) | **Done** | 128 tests, review fixes applied |
| Cloud Functions | **Done** | Badge auto-generation triggers |
| Shared Types | **Done** | All schemas complete |
| Web Backoffice | **Done** (Sprint 1) | Auth guard, CRUD, registrations |
| Mobile (Flutter) | **Done** (Sprint 2) | API client, events, registration, badges |

---

## Tasks

### API (Fastify) — COMPLETE

#### Event Management
- [x] Complete event CRUD endpoints with full validation
- [x] Event publish/unpublish flow with status transitions
- [x] Ticket type management (create, update, disable within event)
- [x] Event image upload endpoint (Cloud Storage signed URL integration)
- [x] Event search/discovery endpoint with filters (category, date range, format, org, city, country, tags, featured)
- [x] Public event listing (no auth required, `optionalAuth` for personalization)

#### Registration
- [x] Verify registration flow end-to-end (register → confirm/pending → badge)
- [x] Registration cancellation with waitlist promotion
- [x] Waitlist promotion when spots open (in-service + Cloud Function trigger)
- [ ] Registration export endpoint (CSV) for organizers *(deferred)*

#### Badge Generation
- [x] Badge PDF generation service (using `pdf-lib`)
- [x] Badge template CRUD (create, list, get, update, archive)
- [x] QR code embedding in badge PDF
- [x] Badge download endpoint for participants (fresh signed URL)
- [x] Bulk badge generation endpoint for organizers (uses cursor pagination)
- [x] Badge status tracking (pending/generated/failed) with error field

#### Security (Review Fixes)
- [x] Org access validation on upload service (cross-tenant prevention)
- [x] Org access on badge download for non-owner access
- [x] Atomic badge duplicate check in Cloud Function (transaction)
- [x] Domain events for all ticket type operations (audit trail)
- [x] Proper type safety — no `as any` in route handlers

### Cloud Functions — COMPLETE

- [x] `onRegistrationCreated` trigger → generate badge automatically
- [x] `onRegistrationApproved` trigger → generate badge for approved registrations
- [x] Waitlist promotion integrated into cancel flow (API-level)

### Shared Types — COMPLETE

- [x] Badge generation request/response schemas
- [x] Event search query schema (EventSearchQuerySchema)
- [x] Badge template CRUD schemas
- [x] Ticket type management schemas
- [x] Upload URL schemas
- [x] Badge status schema (pending/generated/failed)
- [x] Audit actions: event.unpublished, waitlist.promoted, ticket_type.added/updated/removed
- [ ] Registration export schema *(deferred)*

### Web Backoffice (Next.js) — Sprint 1 COMPLETE

- [x] API client layer (typed HTTP service with Firebase Auth token)
- [x] Event list page with filters and pagination
- [x] Event creation form (multi-step: details → tickets → settings → review)
- [x] Event detail/edit page (tabs: Info, Tickets, Registrations)
- [x] Registration list with status filters + approve/reject actions
- [x] Dashboard overview (event count, registration count)
- [x] Auth guard on dashboard layout (redirect to /login if unauthenticated)
- [x] Firebase SDK init fix (initializeFirestore for correct emulator order)

### Mobile (Flutter) — Sprint 2 COMPLETE

- [x] Firebase config with real project credentials + emulator support
- [x] API/data layer (Dio client with Firebase token interceptor)
- [x] Data models (Event, TicketType, EventLocation, Registration)
- [x] Riverpod providers (events list, event detail, registrations, registration notifier)
- [x] Event discovery screen (list + search + category filters + pull-to-refresh)
- [x] Event detail screen (cover image, info, ticket selection, register button)
- [x] Registration flow (select ticket → confirm → success snackbar)
- [x] Badge view screen (QR code display from real registration data)
- [x] Profile page (avatar, stats, menu, logout)
- [x] Feed & Networking pages (Wave 4 placeholders with "coming soon" UI)
- [ ] Pull-to-refresh + offline caching for event list *(deferred to Wave 2)*

---

## Exit Criteria

- [x] Organizer can create and publish an event via web backoffice
- [x] Participant can discover, view, and register for events on mobile
- [x] Badge with QR code is auto-generated on registration
- [x] Participant can view their badge/QR in the app
- [x] Organizer can view and manage registrations in backoffice
- [x] All new endpoints have tests (128 passing)
- [x] Firestore rules updated for any new collections/fields

## Dependencies

- Pre-Wave (foundation hardening) completed ✓
- Firebase Cloud Storage configured for badge PDFs and event images ✓
- PDF generation library chosen and integrated ✓

## Deploys After This Wave

- API: New event, registration, and badge endpoints ✓ (ready)
- Web: Event management + registration dashboard (Sprint 1)
- Mobile: Event discovery + registration + badge view (Sprint 2)
- Functions: Badge generation trigger ✓ (ready)
