# Platform Overview

> **Status: shipped**

## Mission

Teranga makes professional event management accessible to African organizers. Built for the Senegalese market and expanding to francophone West Africa, the platform solves the specific infrastructure challenges of the region:

- **Offline check-in** that works reliably with intermittent mobile data at venues
- **Mobile money payments** (Wave, Orange Money) that match how Senegalese users transact
- **French-first** interfaces with Wolof localization for the broader public

The name *Teranga* is the Wolof word for hospitality — the cultural DNA of every event.

---

## Core value loop

```
Organizer creates event
    └─► Sets ticket types + access zones
          └─► Publishes event
                └─► Participants discover + register (web or mobile)
                      └─► QR badge generated automatically
                            └─► Staff scans QR at venue (online or offline)
                                  └─► Organizer sees real-time analytics + manages communications
```

---

## Target market

| Dimension | Detail |
|---|---|
| **Primary market** | Senegal (Dakar and secondary cities) |
| **Expansion** | Francophone West Africa (Côte d'Ivoire, Mali, Guinea, Cameroon) |
| **Currency** | XOF — CFA Franc BCEAO (WAEMU zone) |
| **Language** | French primary, English secondary, Wolof in progress |
| **Connectivity** | Designed for 3G/4G with graceful offline fallback |

---

## Core differentiators

### 1. Offline-first QR check-in

Staff download an encrypted snapshot of all registrations before entering the venue. When internet is unavailable, they scan locally against the cached data. Scans queue locally and reconcile to the server when connectivity returns.

The QR signing uses HMAC-SHA256 with per-event HKDF-derived keys. A forged or replayed QR code is cryptographically rejected even offline.

See: [QR v4 & offline sync concept](../20-architecture/concepts/qr-v4-and-offline-sync.md)

### 2. Mobile-money native

Wave and Orange Money are first-class payment methods — not afterthoughts bolted onto a Stripe checkout. The payment flow is designed around USSD redirects and mobile callbacks, matching how Senegalese users pay.

### 3. African-market freemium

The free tier is generous enough for grassroots adoption (3 events, 50 participants each). Paid tiers unlock QR scanning, custom badges, CSV export, SMS notifications, and advanced analytics at price points calibrated for the local market (9 900 XOF/month ≈ $16).

### 4. Multi-tenant SaaS

Every organizer belongs to an organization. Plans and limits are enforced at the organization level. Multiple team members can share an organization (roles: owner, admin, member, viewer).

---

## Three client surfaces

### Web back-office (organizers + admins)

Next.js 15 Progressive Web App. The primary tool for organizers to manage events, participants, staff, communications, analytics, and billing. Designed for use on desktop and tablet (organizers often manage events on-site with a tablet).

### Web participant app (public + registered users)

Next.js 15 with SSR/SSG for SEO. Participants discover events, register, download badges, and follow event feeds. Optimized for fast load on African mobile networks. WhatsApp-friendly sharing.

### Mobile app (participants + staff)

Flutter 3 for iOS and Android. Participants use it to find events, register, and display their QR badge. Staff use it as a QR scanner at the venue. Offline-first by design.

---

## What Teranga is not

- Not a livestreaming platform (integration planned, not built)
- Not a CRM (integrations roadmapped for Wave 4+)
- Not a general-purpose ticketing API for third-party developers (API access is an Enterprise plan feature, Wave 10)
- Not Stripe-dependent (African payment methods are the primary integration)
