# Wave 1: Core Loop — Create Event, Register, Generate Badge

**Status:** `in_progress`
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
| Web Backoffice | **Sprint 1 — in progress** | Stub pages → real UI |
| Mobile (Flutter) | **Sprint 2 — not started** | Stub pages → real UI |

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

### Web Backoffice (Next.js) — Sprint 1

- [ ] API client layer (typed HTTP service with Firebase Auth token)
- [ ] Event list page with filters and pagination
- [ ] Event creation form (multi-step: details → tickets → settings → review)
- [ ] Event detail/edit page (tabs: Info, Tickets, Registrations)
- [ ] Registration list with status filters + approve/reject actions
- [ ] Dashboard overview (event count, registration count)

### Mobile (Flutter) — Sprint 2

- [ ] API/data layer (Dio client + Riverpod providers)
- [ ] Event discovery screen (list + search + filters)
- [ ] Event detail screen (info, ticket types, register button)
- [ ] Registration flow (select ticket → confirm → success with QR)
- [ ] My registrations list (with status badges)
- [ ] Badge view screen (QR code display, downloadable PDF)
- [ ] Pull-to-refresh + offline caching for event list

---

## Exit Criteria

- [ ] Organizer can create and publish an event via web backoffice
- [ ] Participant can discover, view, and register for events on mobile
- [x] Badge with QR code is auto-generated on registration
- [ ] Participant can view their badge/QR in the app
- [ ] Organizer can view and manage registrations in backoffice
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
