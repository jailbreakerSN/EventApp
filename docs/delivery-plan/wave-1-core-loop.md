# Wave 1: Core Loop — Create Event, Register, Generate Badge

**Status:** `not_started`
**Estimated effort:** 2 weeks
**Goal:** Complete the primary user journey: organizer creates event → participant registers → badge is generated.

## Why This Wave Matters

This is the **minimum viable product**. Without create → register → badge, there is no Teranga. Every subsequent wave extends this core loop.

---

## Tasks

### API (Fastify)

#### Event Management
- [ ] Complete event CRUD endpoints with full validation
- [ ] Event publish/unpublish flow with status transitions
- [ ] Ticket type management (create, update, disable within event)
- [ ] Event image upload endpoint (Cloud Storage integration)
- [ ] Event search/discovery endpoint with filters (category, date range, location)
- [ ] Public event listing (no auth required, `optionalAuth` for personalization)

#### Registration
- [ ] Verify registration flow end-to-end (register → confirm/pending → badge)
- [ ] Registration cancellation with refund placeholder
- [ ] Waitlist promotion when spots open (via Cloud Function trigger)
- [ ] Registration export endpoint (CSV) for organizers

#### Badge Generation
- [ ] Badge PDF generation service (using `pdf-lib` or `@react-pdf/renderer`)
- [ ] Badge template system (event-specific layouts)
- [ ] QR code embedding in badge PDF
- [ ] Badge download endpoint for participants
- [ ] Bulk badge generation endpoint for organizers (uses cursor pagination)

### Cloud Functions

- [ ] `onRegistrationCreated` trigger → generate badge automatically
- [ ] `onRegistrationApproved` trigger → generate badge for approved registrations
- [ ] Waitlist promotion function (when registration cancelled, promote next waitlisted)

### Web Backoffice (Next.js)

- [ ] Event creation form (multi-step: details → tickets → settings → review)
- [ ] Event list page with filters and pagination
- [ ] Event detail/edit page
- [ ] Registration list for an event (table with status filters)
- [ ] Registration approval/rejection actions
- [ ] Dashboard overview (event count, registration count, revenue placeholder)

### Mobile (Flutter)

- [ ] Event discovery screen (list + search + filters)
- [ ] Event detail screen (info, ticket types, register button)
- [ ] Registration flow (select ticket → confirm → success with QR)
- [ ] My registrations list (with status badges)
- [ ] Badge view screen (QR code display, downloadable PDF)
- [ ] Pull-to-refresh + offline caching for event list

### Shared Types

- [ ] Badge generation request/response schemas
- [ ] Event search query schema
- [ ] Registration export schema
- [ ] Ensure all new endpoints have Zod validation schemas

---

## Exit Criteria

- [ ] Organizer can create and publish an event via web backoffice
- [ ] Participant can discover, view, and register for events on mobile
- [ ] Badge with QR code is auto-generated on registration
- [ ] Participant can view their badge/QR in the app
- [ ] Organizer can view and manage registrations in backoffice
- [ ] All new endpoints have tests
- [ ] Firestore rules updated for any new collections/fields

## Dependencies

- Pre-Wave (foundation hardening) completed
- Firebase Cloud Storage configured for badge PDFs and event images
- PDF generation library chosen and integrated

## Deploys After This Wave

- API: New event, registration, and badge endpoints
- Web: Event management + registration dashboard
- Mobile: Event discovery + registration + badge view
- Functions: Badge generation trigger
