# Roadmap

> **Status: current as of April 2026.** Inferred from codebase state + delivery plan. Features marked shipped are verified in code; planned dates are estimates.

---

## Delivery model

The platform ships in **10 waves**, each building on the previous. The philosophy is web-first: the web back-office and participant web app are the primary delivery vehicles. The Flutter mobile app is deferred to Wave 9 after the web platform is validated.

```
Pre-Wave → Wave 1 → Wave 2 → Wave 3 → Wave 4 → Wave 5 → Wave 6 → Wave 7 → Wave 8 → Wave 9 → Wave 10
```

---

## Current state (April 2026)

**Active work:** Wave 2 (check-in) and Wave 3 (participant web) are shipping. The CI test-hardening sprint (5 phases) is closing out. Dynamic plan catalog Phase 2 migration is in flight.

**Version:** All apps at `v0.1.0`. No production deployment yet — staging only.

---

## Wave status

### ✅ Pre-Wave — Foundation Hardening

*Monorepo setup, Firebase emulators, shared types, CI/CD, seeding, security baseline.*

All foundation work is shipped: Fastify API with layered architecture, Firestore rules (deny-all default), shared Zod types, permission model, domain event bus, audit trail, rate limiting, Helmet, CORS, emulator setup, CI gate.

---

### ✅ Wave 1 — Core Loop

*Events, registrations, badges, QR signing, basic back-office.*

- Event CRUD + publish/unpublish ✅
- Ticket types + access zones ✅
- Registration flow (free tickets) ✅
- QR code signing (v3 legacy → v4 HKDF with kid rotation) ✅
- Badge PDF generation via Cloud Functions ✅
- Back-office event management UI ✅
- Participant web registration + badge download ✅

---

### 🚧 Wave 2 — Check-in API & Dashboard

*Offline-first check-in, staff scanner, real-time dashboard.*

- Live QR scan API ✅
- Offline sync with ECDH-X25519 encryption ✅
- Bulk offline reconciliation ✅
- Scan policies (single, multi-day, multi-zone) ✅
- Access zone capacity enforcement ✅
- Scanner device attestation ✅
- Real-time check-in dashboard (back-office) ✅
- Anomaly detection widget ✅
- Mobile staff scanner UI ⚠ partial (page shell exists, full wiring pending)

---

### 🚧 Wave 3 — Participant Web App

*Public event discovery, SSG/SSR for SEO, WhatsApp sharing.*

- Event discovery with filters ✅
- Event detail (public SSR) ✅
- Participant registration + payment UI ✅ (Wave payments deferred to Wave 6)
- Digital badge + QR display ✅
- Event feed + session schedule ✅
- 1:1 messaging ✅
- Profile + settings ✅
- SEO metadata (JSON-LD, Open Graph) 📅 planned

---

### 📅 Wave 4 — Organizer Productivity

*CSV export, promo codes, session management, speaker tools.*

- CSV export ✅ (shipped ahead of Wave 4)
- Promo codes ✅ (shipped ahead of Wave 4)
- Session / agenda CRUD ✅
- Speaker management ✅
- Co-organizer invitations ✅
- Event cloning ✅
- Advanced analytics (Pro plan) ✅
- Org member management ✅

---

### 📅 Wave 5 — Social & Sessions

*Event feed, session bookmarks, social sharing, networking.*

- Event feed + comments ✅ (shipped in Wave 1/2)
- Session bookmarks ✅
- Speaker portal UI ⚠ partial
- 1:1 participant networking 📅 planned
- Social proof (attendee count, "X people registered") ⚠ partial

---

### 📅 Wave 6 — Payments

*Wave, Orange Money, free tickets confirmed, paid ticket flow.*

- Wave payment provider ✅ (API implemented)
- Orange Money payment provider ✅ (API implemented)
- Payment webhook handling ✅
- Payment timeout + expiry (Cloud Functions) ✅
- Balance ledger ✅
- Payout history ✅
- Card payments (PayDunya/Stripe) 🔲 stub
- Free Money 🔲 stub
- Automated payouts 📅 planned
- Invoice generation 📅 planned (Phase 7)

---

### 📅 Wave 7 — Communications

*Broadcast push/email/SMS, event reminders, automated triggers.*

- Broadcast composer (push + email + SMS) ✅ (shipped)
- Scheduled broadcasts ✅
- Event reminders via Cloud Scheduler ✅
- Session reminders ✅
- FCM push integration ✅
- Resend email integration ✅
- Africa's Talking SMS integration ✅
- Unsubscribe management 📅 planned

---

### 📅 Wave 8 — Portals

*Speaker portal, sponsor portal, lead capture.*

- Speaker profile + session management ⚠ partial (back-office wired, portal UI pending)
- Sponsor booth + lead capture ⚠ partial (API wired, portal UI pending)
- Sponsor analytics 📅 planned
- Speaker speaker-run Q&A 📅 planned

---

### 📅 Wave 9 — Mobile App Completion

*Flutter app at feature parity with web participant app.*

- Auth + events list ✅ (shipped)
- Event registration UI 🔲 stub
- Badge + QR display 🔲 stub
- Staff QR scanner 🔲 stub
- Event feed 🔲 stub
- Offline check-in (Hive + sync) 📅 planned
- Push notifications 📅 planned
- 1:1 networking 📅 planned

---

### 📅 Wave 10 — Production Launch

*Production Firebase project, production deploy pipeline, monitoring, stress testing.*

- Production GCP project (`teranga-events-prod`) 📅 planned
- Production deploy workflow 📅 planned
- Load testing 📅 planned
- GDPR compliance (data export + deletion) 📅 planned
- SOC 2 audit trail completeness review 📅 planned
- API access (Enterprise plan) 📅 planned
- White-label (Enterprise plan) 📅 planned

---

## Post-launch: potential expansions

See [Industry gap analysis](../70-future/industry-gap-analysis.md) and [Must-have features](../70-future/must-have-features.md) for the full gap analysis against Eventbrite, Cvent, Hopin, Luma, and Bizzabo.

Key candidates:
- **Algolia search** for event discovery at scale
- **Webhooks API** for organizer integrations
- **CRM integrations** (HubSpot, Salesforce)
- **Virtual/hybrid events** (streaming integration)
- **Multi-event campaigns** (discount bundles, loyalty)
- **Kiosk check-in mode** (self-check-in on tablet at entrance)
