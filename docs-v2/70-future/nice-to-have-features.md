---
title: Nice-to-Have Features
status: planned
last_updated: 2026-04-25
---

# Nice-to-Have Features

> Features that would strengthen the platform and improve retention, but are not blocking production launch or core feature parity. Ordered by strategic value.

---

## Discoverability & Growth

### Recurring events

**Value:** Meetup groups, weekly classes, and monthly professional events need recurring templates. Without this, organizers manually clone events every cycle.

**What's needed:**
- `recurrenceRule` on event (RRULE format or simple weekly/monthly enum)
- Clone + date-shift logic on publish
- Participant UI that shows all occurrences in a series
- Registration carries through to a single occurrence, not the series

---

### Event sitemap + SEO XML

**Value:** Complements the JSON-LD / Open Graph P0 work. A dynamic `sitemap.xml` signals all event URLs to Google. Important for organic discovery of the full catalog.

**What's needed:**
- `GET /sitemap.xml` on `web-participant` (Next.js route handler)
- Includes all published, non-past events
- Regenerated on event publish/unpublish via ISR revalidation
- Ping Google Search Console on regeneration

---

### Calendar sync (Google Calendar, Apple Calendar, Outlook)

**Value:** "Add to Calendar" is expected by professional attendees. Every major platform supports it. Low effort, high satisfaction.

**What's needed:**
- `.ics` file generation per event (or per registration)
- `webcal://` link on confirmation page and badge
- ICS served from `web-participant` with correct MIME type
- Update ICS when event details change (organizer edits)

---

### Smart recommendations (collaborative filtering)

**Value:** Participants who attend similar events should be recommended new events. Increases discovery and repeat attendance.

**What's needed:**
- `attendanceHistory` vector per user (event categories, tags)
- Simple collaborative filter or tag overlap scoring (no ML required initially)
- Recommendation feed endpoint: `GET /v1/users/me/recommendations`
- "You might like" section on home page / participant app

---

## Organizer Productivity

### Email template editor

**Value:** The Resend integration is wired but all templates are hardcoded. Organizers want to customize transactional emails (logo, color, event-specific message).

**What's needed:**
- WYSIWYG template editor in backoffice (basic blocks: header, text, button, footer)
- Template variables: `{{participantName}}`, `{{eventName}}`, `{{badgeUrl}}`, etc.
- Templates stored per organization, with system defaults as fallback
- Preview mode before sending

---

### Duplicate / clone event from dashboard

**Value:** The clone API endpoint (`POST /v1/events/:eventId/clone`) exists but there is no UI entry point. Organizers discover it only by accident.

**What's needed:**
- "Duplicate event" action in event list context menu
- Date-shift dialog: "New start date?"
- Copies ticket types, sessions, access zones — NOT registrations
- Redirect to the new event's settings page after clone

---

### Bulk actions on registrations

**Value:** Managing 500+ registrations one-by-one is painful. Bulk approve, bulk cancel, bulk email are daily needs for large events.

**What's needed:**
- Multi-select checkboxes in the registrations table
- Actions: approve selected, cancel selected, send email to selected, export selected
- Backend: batch Firestore writes (max 500 per batch)
- Progress indicator for long operations

---

### Co-organizer invitation by link

**Value:** Currently co-organizers must be added by UID or email via API. A shareable invite link (like Google Docs sharing) is much more practical at events.

**What's needed:**
- `POST /v1/events/:eventId/co-organizer-link` — generates a short-lived token
- Recipient opens link → prompted to log in → added as co_organizer
- Link expires in 48h, single-use
- Revoke link UI in event settings

---

### Event brief / run-of-show export (PDF)

**Value:** Organizers print a run-of-show document on event day. Teranga has all the data (schedule, speakers, staff list, sponsor list) to generate it automatically.

**What's needed:**
- PDF template: cover page, schedule table, speaker bios, sponsor logos, staff contacts
- `GET /v1/events/:eventId/brief.pdf`
- Regenerated on-demand (no caching needed)
- Uses the same `@react-pdf/renderer` or `pdfkit` stack as badges

---

## Participant Experience

### Group ticket purchase

**Value:** A company buying 10 tickets for employees, or a family buying 3 tickets for the same event, is a common scenario. Without group tickets, each person must register individually.

**What's needed:**
- `quantity` field in registration request (max configurable per ticket type)
- Each participant in the group gets their own badge
- Primary buyer fills in names/emails for other participants (or they fill in later via link)
- Single payment covers all

---

### Saved events / wishlist

**Value:** Participants browse events weeks in advance but don't register immediately. A saved events list reduces bounce and creates a re-engagement surface.

**What's needed:**
- `POST /v1/events/:eventId/save` and `DELETE` equivalent
- `GET /v1/users/me/saved-events`
- Heart icon on event cards (web-participant + mobile)
- Optional: email reminder 24h before ticket sales close for saved events

---

### Participant event history and replay

**Value:** "What events did I attend this year?" is a natural participant question. A timeline of past events with badges and certificates is a retention driver.

**What's needed:**
- `GET /v1/users/me/registrations?status=attended&include=badge`
- Timeline UI in participant profile
- Downloadable badge PDF link per past event
- Certificate PDF link (if event issued one)

---

### QR code sharing (referral)

**Value:** Each participant has a unique referral QR that gives both parties a small discount when a friend registers via that link.

**What's needed:**
- `referredBy` field on registration
- Referral link: `teranga.events/e/{slug}?ref={userId}`
- Discount applied at checkout (promo code auto-generated per referral)
- Referral count in participant profile

---

## Professional Events

### Speaker submission portal (front end)

**Value:** The speaker portal back-end is marked `⚠ partial` — the API is wired but there is no dedicated public-facing submission form. Conference organizers need a CFP (call for papers) URL to share.

**What's needed:**
- Public `/e/{slug}/speakers/submit` page (no auth required initially)
- Fields: name, bio, session title, abstract, track, company, social links
- Submission creates a `speaker` document with `status: pending`
- Organizer reviews in backoffice (approve / reject)
- Email notification on status change

---

### Sponsor booth and lead capture (public facing)

**Value:** Sponsors pay for visibility and lead capture. Currently the sponsor portal has a backoffice admin UI but no participant-facing booth page.

**What's needed:**
- Sponsor booth page: `/e/{slug}/sponsors/{sponsorId}`
- Participant can "visit" a booth (tap/click) → logged as a sponsor lead
- Lead capture form (name, email, company, interest level)
- Sponsor dashboard shows visit count + leads with export

---

### Survey and post-event feedback

**Value:** NPS, session ratings, and open feedback are standard deliverables for corporate event reports. Increases organizer retention (they need the data for budget justification).

**What's needed:**
- Survey builder in backoffice: rating scale, multiple choice, open text
- Survey linked to event, triggered on check-out or day-after
- `POST /v1/events/:eventId/survey-responses`
- Results dashboard: NPS score, average ratings, word cloud from open text
- Export to CSV

---

### Event certificates (PDF generation)

**Value:** Workshops, training sessions, and conferences issue certificates of attendance. Participants add them to LinkedIn. High-value touch for professional events.

**What's needed:**
- Certificate template with organizer logo, participant name, event name, date
- `GET /v1/registrations/:id/certificate.pdf`
- Triggered automatically on `registration.checkedIn` domain event
- Add-to-LinkedIn share link on certificate page
- Organizer can disable certificates per event

---

## Platform & Integrations

### Zapier / Make integration

**Value:** Non-technical organizers connect Teranga to their tools (Mailchimp, Airtable, Notion, Slack) without writing code. Depends on the Webhook API.

**What's needed:**
- Published Zapier app or Make module (official Zapier developer account)
- Triggers: new registration, check-in, event published
- Actions: create registration, mark attended
- OAuth2 app for Zapier auth (reuses existing `apiAccess` Enterprise gate)

---

### CRM sync (HubSpot / Salesforce)

**Value:** Corporate event organizers need registrant data in their CRM automatically. Currently they export CSV and import manually — too slow for high-frequency events.

**What's needed:**
- OAuth2 HubSpot connection per organization
- Sync registrations as HubSpot contacts on creation
- Sync check-in status as a contact property update
- Field mapping configuration (Teranga field → HubSpot property)
- Salesforce connector as follow-on (same interface)

---

### Custom domain for event pages

**Value:** Corporate clients want `events.company.com/my-event` instead of `teranga.events/e/my-event`. Required for Enterprise plan credibility and white-label.

**What's needed:**
- Custom domain field on organization
- DNS CNAME setup instructions in backoffice
- SSL auto-provisioned (Vercel or Firebase Hosting custom domain)
- Canonical URL in SEO metadata points to custom domain

---

### Algolia full-text search

**Value:** Client-side filtering on a growing event catalog (100+ events) becomes slow. Algolia provides instant search with facets (category, date, location, price, language).

**What's needed:**
- Algolia index sync on event publish/update/unpublish (Cloud Function trigger)
- Search endpoint or direct Algolia InstantSearch on web-participant
- Facets: category, city, free/paid, upcoming/past, language
- Typo-tolerant Wolof and French search

---

### Multi-language event content

**Value:** Currently the platform UI is FR/EN/WO but event content (title, description) is single-language. Events targeting mixed French/English audiences need bilingual pages.

**What's needed:**
- `title: { fr: string, en?: string, wo?: string }` structure on events
- Fallback chain: requested locale → fr → first available
- Organizer fills alternate languages in event settings (optional)
- `Accept-Language` header used for API response locale selection

---

## Mobile (Flutter)

### Organizer mobile app

**Value:** The Flutter app is currently participant-only. Organizers at events need mobile check-in stats, quick registration lookups, and push notifications.

**What's needed:**
- Organizer mode detection (role in Firebase claims → different bottom nav)
- Organizer home: live event summary (checked-in count, registrations, revenue)
- Quick registration lookup by name
- Push notification on new registration, payment, cancellation
- Requires Wave 9 scope extension

---

### Offline message queue (messaging)

**Value:** The messaging feature requires connectivity. At venues with poor signal, messages sent should queue and deliver when the connection recovers.

**What's needed:**
- Hive queue for outgoing messages
- Flush queue on network reconnect (ConnectivityPlus listener)
- Duplicate prevention (Firestore transaction on message doc)
- UI indicator: "message queued" → "sent"

---

## Compliance & Trust

### GDPR unsubscribe

**Value:** Required for email compliance when serving EU-based participants. Currently the Resend integration sends transactional email without an unsubscribe mechanism.

**What's needed:**
- `unsubscribed: boolean` field on user document
- One-click unsubscribe link in all transactional emails (Resend List-Unsubscribe header)
- `POST /v1/users/me/unsubscribe?token=...` (signed token, no auth required)
- Unsubscribe state respected before sending any email

---

### Organizer terms acceptance and DPA

**Value:** GDPR requires a Data Processing Agreement between Teranga (processor) and each organizer (controller) who collects EU participant data.

**What's needed:**
- DPA acceptance flow during org creation
- DPA template (legal draft)
- Acceptance timestamp stored on organization document
- DPA download link in organization settings
- Required before first paid event publish

---

### Accessibility audit (WCAG 2.1 AA)

**Value:** The backoffice was built fast. Screen reader support, keyboard navigation, and color contrast have not been systematically checked.

**What's needed:**
- Automated axe-core scan in CI (fail on critical violations)
- Manual keyboard navigation review of: event wizard, registration flow, check-in scanner
- Color contrast check of all `teranga-navy / teranga-gold / teranga-green` combinations
- ARIA labels on all icon-only buttons

---

## Analytics & Reporting

### Conversion funnel tracking

**Value:** Understanding where participants drop off (view → start registration → payment → completion) guides product improvements. Currently there is no funnel tracking.

**What's needed:**
- Client-side events: `page_view`, `registration_started`, `payment_initiated`, `registration_completed`
- Server-side events: same with userId + sessionId
- Funnel visualization in backoffice analytics tab
- Segment or Amplitude as the event sink (or build on Firestore analytics collection)

---

### Organizer ROI dashboard

**Value:** Organizers justify event budget with reports. A summary of revenue, attendance rate, NPS, and social reach in one PDF would be a strong retention feature.

**What's needed:**
- Post-event report: revenue, attendee count, no-show rate, NPS, top referral source
- `GET /v1/events/:eventId/report.pdf`
- Generated D+1 after event ends
- Sent automatically to organizer email

---

### Financial reconciliation report (payout statement)

**Value:** Organizers need an accounting document for each event cycle. Currently payments are tracked but there is no formatted payout statement.

**What's needed:**
- Payout statement PDF: gross revenue, platform fee, net payout, VAT breakdown
- `GET /v1/organizations/:orgId/payouts/:payoutId/statement.pdf`
- Sent to organizer on each payout
- Matches what appears in their Wave/Orange Money account

