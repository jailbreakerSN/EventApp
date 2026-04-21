# Must-Have Features

> Features that are **required** before the platform can be considered production-ready or compete effectively in the Senegalese market. Prioritized by revenue impact and user adoption risk.

---

## P0 — Revenue blockers (must ship before Wave 10 launch)

### Card payments (PayDunya or Stripe)

**Impact:** Organizers cannot accept international payment. Corporate clients, sponsors, and expats cannot pay by card. Blocks B2B events.

**What's needed:**
- PayDunya integration (preferred for Senegal — supports local banks and cards)
- Stripe as fallback for international cards
- Webhook handler (reuse existing pattern from Wave/OM)
- Payment method selector in checkout UI

**Code stub:** `payment.service.ts` has `card: mockPaymentProvider` — needs real implementation.

---

### GDPR data export + right to deletion

**Impact:** Legally required for any event serving EU participants. Events with international attendees (embassies, NGOs, tech conferences) will reject Teranga without this.

**What's needed:**
- `GET /v1/users/me/data-export` — exports all user data as JSON/ZIP
- `DELETE /v1/users/me` — anonymizes user data (not hard-delete, but pseudonymization)
- Email workflow with 30-day confirmation
- Data processing agreement (DPA) template for organizers

---

### SEO metadata for event pages (JSON-LD + Open Graph)

**Impact:** WhatsApp sharing shows blank previews. Google does not index events. Organic discovery is blocked without this.

**What's needed:**
- `<meta og:...>` tags on event detail pages (web-participant SSR — easy to add)
- JSON-LD `Event` schema on event detail pages
- Dynamic `<title>` and `<meta description>` from event data
- Twitter/X card tags

**Effort:** Low — Next.js `generateMetadata()` in `app/events/[slug]/page.tsx`.

---

## P1 — Core feature parity (required for retention)

### Registration with custom questions

**Impact:** Many organizers need dietary preferences, job title, T-shirt size, or session track selection. Without custom fields, they stay with Google Forms + manual import.

**What's needed:**
- `customFields: { label, type, required }[]` on ticket type or event
- Dynamic form rendering in participant registration flow
- Field responses stored in registration document
- Included in CSV export

---

### Refund flow

**Impact:** Events get cancelled. Without a refund mechanism, organizers face chargebacks or have to handle refunds manually via WhatsApp. This is both a trust and operational issue.

**What's needed:**
- `POST /v1/payments/:id/refund` endpoint
- Partial and full refund support (for tiered cancellation policies)
- Wave/Orange Money refund API integration
- Organizer-facing refund UI in event payments tab
- Participant notification on refund

---

### Abandoned registration recovery

**Impact:** Participants who start registration but don't complete payment (Wave USSD redirect bounce rate is ~20%) are lost. Recovery email increases conversion by 10–15% on comparable platforms.

**What's needed:**
- `pending_payment` registration TTL (already set to 1 hour in code)
- Before expiry: send reminder email "You have 30 minutes to complete your registration"
- Cloud Functions scheduled trigger on payment documents

---

### Apple Wallet / Google Wallet passes

**Impact:** Senegal smartphone penetration is high. Participants expect to show a Wallet pass at the venue instead of opening an app. This is table stakes for professional events.

**What's needed:**
- `.pkpass` generation for Apple Wallet (pass.js or similar)
- Google Wallet pass generation API
- Add-to-Wallet button on badge page (web + mobile)
- Pass update on badge regeneration

---

### Kiosk check-in mode

**Impact:** Large events (500+ participants) need kiosk tablets at the entrance for self-check-in. Staff-assisted scanning does not scale. Eventbrite, Cvent all offer this.

**What's needed:**
- Dedicated kiosk UI (full-screen, touch-optimized, no nav)
- Auto-opens camera on start
- Participant can type name as fallback
- "Thank you" confirmation screen with countdown back to scanner
- Runs offline against the same sync snapshot as staff scanner

---

## P2 — Growth features (competitive differentiation)

### 1:1 networking (meeting scheduler)

**Impact:** Professional conferences live or die by networking. Teranga's "bientôt disponible" networking feature, once shipped, would differentiate from Eventbrite and Luma.

### Webhook API

**Impact:** Enables CRM sync, custom automations, and third-party integrations. Required for Enterprise plan credibility. Eventbrite provides this and organizers depend on it for HubSpot/Salesforce sync.

### Algolia full-text search

**Impact:** Client-side search over a growing event catalog (100+ events) becomes slow. Algolia provides instant search with facets. Required before Wave 10 public launch.

### Survey / post-event feedback

**Impact:** Organizers need NPS scores and session ratings. Every major platform has this. Increases repeat events (organizer retention) and participant engagement.

### Event certificates (PDF generation)

**Impact:** Conferences, workshops, and training events issue certificates of attendance. Participants need them for LinkedIn and employer reporting. High retention driver for professional events.
