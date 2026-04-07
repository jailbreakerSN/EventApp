# MVP Launch Sprint — Dakar Market Ready

**Status:** `in_progress`
**Estimated effort:** 3-4 weeks (3 sprints)
**Goal:** Bridge the gap between "code complete" and "market ready" — integrate real providers, add quick-win features, harden the web platform for real organizers in Dakar.

## Why This Sprint Exists

The platform audit (2026-04-07) revealed that Waves 1-5 are production-ready but Waves 6-8 rely on mock providers and incomplete frontends. This sprint addresses every gap that blocks real usage, ordered by business impact.

**What "Dakar MVP Ready" means:**
- A real organizer can create a paid event, collect money via Wave/Orange Money, and see revenue
- Participants discover events via Google/WhatsApp, register, pay, and get SMS/email confirmations
- Speakers and sponsors can self-serve (manage profiles, scan leads, export data)
- The platform works reliably on African networks (slow 3G, intermittent connectivity)

---

## Sprint 1: Quick Wins + SEO (3-5 days)

**Goal:** Maximum perceived value with minimum effort. Ship features that drive organic discovery and social sharing.

### Web Participant App

- [ ] **WhatsApp share button** on event detail page
  - `wa.me/?text=` with pre-formatted French message (title, date, link)
  - Also add Facebook, X (Twitter), and "Copier le lien" buttons
  - Component: `apps/web-participant/src/components/share-buttons.tsx`

- [ ] **"Ajouter au calendrier"** on registration confirmation + badge page
  - Generate `.ics` file content (iCalendar format)
  - Google Calendar link (URL parameter format)
  - Show on registration success page and my-events page

- [ ] **Sitemap + robots.txt** for SEO
  - `apps/web-participant/src/app/sitemap.ts` — query published events, generate XML
  - `apps/web-participant/src/app/robots.ts` — allow all crawlers
  - Add `<link rel="sitemap">` to layout

- [ ] **Social proof on event pages**
  - Show "X personnes inscrites" prominently with icon
  - Progress bar toward capacity (if maxAttendees set)
  - "Plus que X places" urgency when >80% full

- [ ] **Public homepage with featured events**
  - Improve landing page: featured events carousel, upcoming events grid
  - Category quick-filters (conférence, atelier, networking, etc.)
  - No auth required — drive discovery

### API

- [ ] **Promo/discount code system**
  - New schema: `PromoCodeSchema` in shared-types (code, discountType, discountValue, maxUses, usedCount, expiresAt, ticketTypeIds)
  - New service: `promo-code.service.ts` — create, validate, apply
  - Hook into registration flow: validate code → adjust payment amount
  - New collection: `promoCodes` in Firestore
  - Routes: POST/GET/DELETE on `/v1/events/:eventId/promo-codes`
  - Backoffice UI: promo code management in event detail page

- [ ] **Calendar endpoint** — `GET /v1/events/:eventId/calendar.ics`
  - Returns iCalendar format with event title, description, location, dates
  - No auth required (public events)

### Tests

- [ ] Promo code service tests (create, validate, apply, expiry, max uses)
- [ ] Calendar endpoint test

---

## Sprint 2: Real Providers + Cloud Functions (1-1.5 weeks)

**Goal:** Replace all mock providers with real integrations. Complete payment lifecycle Cloud Functions.

### Payment Integration (Wave 6 completion)

- [ ] **Wave payment provider** (`apps/api/src/providers/wave.provider.ts`)
  - Implement `PaymentProvider` interface
  - Initiate payment → redirect to Wave checkout page
  - Webhook handler for payment confirmation/failure
  - Idempotent webhook processing (existing pattern)
  - XOF amount handling (integers only)
  - Test with Wave sandbox API

- [ ] **Orange Money payment provider** (`apps/api/src/providers/orange-money.provider.ts`)
  - Same `PaymentProvider` interface
  - Orange Money API integration
  - Webhook handler
  - Test with Orange Money sandbox

- [ ] **Payment provider routing**
  - Select provider based on `method` field in `InitiatePaymentSchema`
  - Configuration via environment variables (API keys, secrets)
  - Fallback to mock in development (`NODE_ENV !== 'production'`)

- [ ] **Payment lifecycle Cloud Functions**
  - `onPaymentCompleted` → confirm registration + trigger badge generation
  - `onPaymentFailed` → notify participant, suggest retry
  - `onPaymentTimeout` → cancel pending registration after configurable window (default 30 min)
  - Scheduled: daily payout reconciliation job

### Communication Integration (Wave 7 completion)

- [ ] **Africa's Talking SMS provider** (`apps/api/src/providers/africastalking-sms.provider.ts`)
  - Implement `SmsProvider` interface
  - Send SMS with rate limiting (1 SMS/user/hour for non-critical)
  - Delivery status tracking via callback
  - Phone number validation: +221 format for Senegal
  - Template system: registration confirmation, event reminder, check-in receipt
  - French templates < 160 chars (single SMS)

- [ ] **SendGrid email provider** (`apps/api/src/providers/sendgrid-email.provider.ts`)
  - Implement `EmailProvider` interface
  - HTML email templates with event branding
  - Registration confirmation email with badge PDF attachment
  - Event reminder email (24h and 1h before)
  - Bounce/complaint handling → disable email for hard bounces

- [ ] **Scheduled event reminders** (Cloud Function)
  - Cron trigger: runs every 15 minutes
  - Query events starting in 24h or 1h
  - Send reminders via user's preferred channels
  - Deduplication: don't re-send if already sent

- [ ] **Phone number validation**
  - Validate +221 format (9 digits after country code) on registration
  - Shared validation function in shared-types
  - Apply in user profile update and sponsor contact

### Tests

- [ ] Wave provider tests (with mock HTTP calls)
- [ ] Africa's Talking SMS provider tests
- [ ] SendGrid email provider tests
- [ ] Payment lifecycle Cloud Function tests
- [ ] Scheduled reminder tests

---

## Sprint 3: Portals + Upload UI + Polish (1-1.5 weeks)

**Goal:** Complete speaker/sponsor self-service, add file upload UI across all apps, and polish for launch readiness.

### Speaker Portal (Wave 8 completion)

- [ ] **Speaker self-service page** in web-participant
  - View assigned sessions with schedule
  - Edit profile (bio, photo, social links, topics)
  - Upload presentation slides (PDF via signed URL)
  - View session attendance/feedback (when available)
  - Route: `/speaker/[eventId]`

- [ ] **Speaker invitation flow**
  - Organizer sends invite from backoffice → creates `invites` doc
  - Speaker receives email/SMS with link
  - Speaker accepts → account created (or linked if exists) → speaker profile auto-created

### Sponsor Portal (Wave 8 completion)

- [ ] **Sponsor self-service page** in web-participant
  - Manage booth (title, description, banner, CTA)
  - View collected leads with notes
  - Export leads as CSV (wire existing API endpoint)
  - Route: `/sponsor/[eventId]`

- [ ] **Sponsor lead export**
  - CSV download button in sponsor portal
  - Columns: name, email, phone, notes, tags, scannedAt
  - Wire existing `exportLeads` API endpoint

### File Upload UI (cross-cutting)

- [ ] **Upload component** in shared-ui
  - Drag-and-drop + click-to-select
  - Progress indicator
  - Preview for images
  - Uses signed URL pattern (request URL → PUT file → PATCH entity)

- [ ] **Event image upload** in web-backoffice
  - Cover image + banner on event creation/edit form
  - Organization logo upload on settings page

- [ ] **Speaker photo upload** in speaker portal + backoffice
- [ ] **Sponsor logo/banner upload** in sponsor portal + backoffice

### Backoffice Improvements

- [ ] **Registration approval UI** — bulk approve/reject for events with `requiresApproval`
- [ ] **Bulk badge generation button** — trigger bulk generation for all confirmed registrations
- [ ] **Sponsor tier configuration** — UI for defining tier names and perks per event
- [ ] **Lead export button** in sponsor management tab

### Accessibility & Polish

- [ ] ARIA labels on all icon-only buttons (Trash, Edit, Scan, etc.)
- [ ] Skeleton loaders for data-fetching pages (replace spinner-only states)
- [ ] Empty state improvements (icon + CTA, not just text)
- [ ] Form validation error messages in French (context-specific, not generic)
- [ ] Offline badge caching — service worker caches QR code for offline display

### Tests

- [ ] Upload component integration tests
- [ ] Speaker portal route tests
- [ ] Sponsor CSV export test

---

## Exit Criteria — MVP Launch Ready

### Revenue Path ✅
- [ ] Organizer creates paid event with XOF pricing
- [ ] Participant pays via Wave mobile money and receives SMS + email confirmation
- [ ] Badge auto-generates after payment confirmation
- [ ] Organizer sees revenue dashboard with real transaction data
- [ ] Promo codes work (create, share, apply discount)

### Discovery & Growth ✅
- [ ] Public homepage shows featured/upcoming events without login
- [ ] Google indexes event pages (sitemap submitted, JSON-LD verified)
- [ ] WhatsApp share sends rich preview (OG tags + share button)
- [ ] "Add to Calendar" works (Google Calendar + .ics download)
- [ ] Social proof visible (registration count, urgency messaging)

### Stakeholder Self-Service ✅
- [ ] Speaker can edit profile, view schedule, upload slides
- [ ] Sponsor can manage booth, view leads, export CSV
- [ ] Organizer can upload event images, speaker photos, sponsor logos

### Communication ✅
- [ ] SMS confirmation sent on registration (real provider, +221 numbers)
- [ ] Email confirmation sent with badge PDF attachment
- [ ] Event reminders sent 24h and 1h before (automated)
- [ ] Organizer can broadcast to registrants (push + SMS + email)

### Quality ✅
- [ ] All tests pass (target: 300+)
- [ ] ARIA labels on all interactive elements
- [ ] Loading skeletons on all data-fetching pages
- [ ] Error states show retry option
- [ ] French strings throughout (no English leaks)

---

## Dependencies

- Wave Business API sandbox access + production keys
- Orange Money API sandbox access + production keys
- Africa's Talking account with SMS credits (Senegal coverage)
- SendGrid or Resend account with sender domain verified
- Firebase project production environment ready

## Branch Strategy

```
main ──────────────────────────────────────────────────────────►
  └── feature/mvp-sprint-1 (quick wins + promo codes) ── merge
  └── feature/mvp-sprint-2 (real providers) ──────────── merge
  └── feature/mvp-sprint-3 (portals + upload + polish) ─ merge
                                                          │
                                                          └── tag v1.0.0-beta
                                                          └── beta testing with 5-10 Dakar organizers
```

## Post-MVP (Wave 9 + 10)

After the MVP is validated with real Dakar organizers:

1. **Wave 9**: Mobile app completion (offline QR scanner, push notifications, full Flutter app)
2. **Wave 10**: Production hardening (load testing, monitoring, app store submission)
3. **Growth features**: Recurring events, certificates, post-event surveys, embed widget, multi-currency (XAF, NGN)

---

## What This Sprint Does NOT Include (and why)

| Temptation | Why not |
|---|---|
| Mobile app (Wave 9) | Validate web MVP first with real organizers |
| Load testing (Wave 10) | Premature — need real usage data first |
| Multi-currency | XOF only for Dakar launch; expand later |
| USSD fallback | Small user segment; prioritize after SMS |
| Live streaming / video | Not in MVP scope; focus on in-person events |
| Custom registration forms | Important but not blocking; add in v1.1 |
| Recurring events | Manual clone works for now; automate post-launch |
