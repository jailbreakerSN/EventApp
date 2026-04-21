# Industry Gap Analysis

> Analysis against leading event management platforms as of April 2026. Status reflects Teranga's current implementation.

---

## Comparable platforms

| Platform | Market | Strengths | Teranga alignment |
|---|---|---|---|
| **Eventbrite** | Global mass market | Discovery, ticketing, SEO | Similar but Africa-first, mobile-money native |
| **Luma** | Tech/professional events | Beautiful UX, networking, calendar integration | Similar aesthetic goal; Teranga goes deeper on offline/check-in |
| **Cvent** | Enterprise conferences | Complex registration, hotel blocks, RFP | Teranga targets SME/grassroots segment, not enterprise yet |
| **Hopin** | Virtual/hybrid events | Streaming, virtual networking, expo | Teranga is in-person first; hybrid is Wave roadmap |
| **Bizzabo** | Enterprise marketing | CRM integrations, analytics, white-label | Teranga's Enterprise plan targets similar but simpler use case |
| **Swapcard** | Professional networking | AI matchmaking, 1:1 meetings | Teranga's networking feature is "bientôt disponible" |
| **Splash** | Brand events | Design-heavy, RSVP management | Similar to Teranga's editorial UX direction |

---

## Feature gap matrix

| Category | Feature | Eventbrite | Luma | Teranga | Status |
|---|---|---|---|---|---|
| **Discovery** | SEO-optimized event pages | ✅ | ✅ | ⚠ partial | Missing JSON-LD, Open Graph |
| **Discovery** | Event sitemap | ✅ | ✅ | 🔲 stub | Not implemented |
| **Discovery** | Search with Algolia/Elasticsearch | ✅ | ✅ | 🔲 stub | Client-side filter only |
| **Discovery** | Recurring events | ✅ | ✅ | 📅 planned | Not planned yet |
| **Registration** | Group tickets (buy for multiple) | ✅ | ✅ | 📅 planned | Not implemented |
| **Registration** | Custom registration questions | ✅ | ✅ | 📅 planned | Not implemented |
| **Registration** | Waitlist with position display | ✅ | ✅ | ⚠ partial | Waitlist exists, position not shown |
| **Payments** | Card payments | ✅ | ✅ | 🔲 stub | PayDunya/Stripe pending |
| **Payments** | Refunds flow | ✅ | ✅ | 🔲 stub | Refund status type exists, no flow |
| **Payments** | Free Money | — | — | 🔲 stub | Senegal-specific, pending provider |
| **Check-in** | Kiosk mode (self-check-in) | ✅ | — | 📅 planned | Self-check-in at kiosk tablet |
| **Check-in** | Apple Wallet / Google Wallet badge | ✅ | ✅ | 📅 planned | QR in Wallet |
| **Analytics** | Conversion funnel | ✅ | ⚠ | 📅 planned | Registration funnel not tracked |
| **Analytics** | Abandoned registration recovery | ✅ | — | 📅 planned | Not tracked |
| **Networking** | 1:1 meeting scheduler | ⚠ | ✅ | 📅 planned | Mobile placeholder only |
| **Networking** | AI matchmaking | — | ✅ | 📅 planned | Long-term |
| **Networking** | Business card exchange | — | ✅ | 📅 planned | Sponsor lead capture exists |
| **Speakers** | Speaker submission portal | ✅ | ⚠ | ⚠ partial | Back-end wired, portal UI pending |
| **Sponsors** | Sponsor analytics | ✅ | — | 📅 planned | Lead capture exists, no analytics |
| **Comms** | Transactional email templates | ✅ | ✅ | ⚠ partial | Resend wired, no template editor |
| **Comms** | GDPR unsubscribe | ✅ | ✅ | 📅 planned | Required for EU events |
| **Integrations** | Webhooks API | ✅ | ✅ | 📅 planned | apiAccess = Enterprise plan |
| **Integrations** | Zapier / Make | ✅ | ✅ | 📅 planned | Depends on webhook API |
| **Integrations** | CRM (HubSpot, Salesforce) | ✅ | — | 📅 planned | Enterprise feature |
| **Integrations** | Calendar sync (Google, Apple) | ✅ | ✅ | 📅 planned | Not planned |
| **Compliance** | GDPR data export | ✅ | ✅ | 📅 planned | Wave 10 |
| **Compliance** | Right to deletion | ✅ | ✅ | 📅 planned | Currently soft-delete only |
| **Platform** | Multi-language event pages | ✅ | — | 📅 planned | FR/EN/WO for UI; event content is single language |
| **Platform** | Custom domain | ✅ | ✅ | 📅 planned | Enterprise/white-label |
| **Platform** | White-label | ✅ | — | 📅 planned | Enterprise plan |
| **Mobile** | Organizer mobile app | ✅ | ✅ | 📅 planned | Flutter is participant-only today |

---

## Teranga's unique advantages

| Feature | Other platforms | Teranga |
|---|---|---|
| **Mobile money payments** | Stripe-centric | Wave + Orange Money native |
| **Offline check-in** | Requires connectivity | ECDH-encrypted snapshot, fully offline |
| **QR key rotation** | Static QR codes | HKDF per-event keys with rotation |
| **Wolof localization** | None | In progress |
| **XOF pricing** | USD/EUR only | Native XOF, Africa/Dakar timezone |
| **Africa-aware UX** | Generic | Network-conscious, mobile-first |
