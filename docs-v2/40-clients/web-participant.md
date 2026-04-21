# Web Participant App

> **Status: ~70% shipped** — Event discovery, registration, badge, feed, and messaging are functional. Speaker/sponsor portals and SEO metadata are pending.

App: `apps/web-participant/`  
Tech: Next.js 15, React 19, TypeScript, TailwindCSS, Firebase Auth (optional), TanStack Query v5, next-intl

---

## Overview

The participant web app is the public-facing event discovery and registration surface. It is optimized for:

- **Fast load on African mobile networks** — SSG/ISR for public pages
- **SEO** — server-rendered event detail pages for WhatsApp sharing and Google indexing (JSON-LD planned)
- **Progressive registration** — participants can browse anonymously, authenticate at registration time

**Base URL:** http://localhost:3002 (local)

---

## Route tree

### Public (unauthenticated)

| Route | Status | Notes |
|---|---|---|
| `/` | ✅ | Hero + featured events + discovery grid + "how it works" |
| `/events` | ✅ | Full event catalog with category/search filters |
| `/events/[slug]` | ✅ | Event detail: description, speakers, schedule, registration CTA |
| `/events/compare` | ⚠ partial | Side-by-side event comparison |
| `/pricing` | ✅ | Subscription tier comparison for organizers |
| `/faq` | ✅ | FAQ page |
| `/terms`, `/privacy`, `/legal` | ✅ | Legal pages |

### Auth

| Route | Status | Notes |
|---|---|---|
| `/login` | ✅ | Firebase email/password |
| `/register` | ✅ | Account creation |
| `/forgot-password` | ✅ | Password reset |
| `/verify-email` | ✅ | Email verification required for paid events |

### Authenticated participant

| Route | Status | Notes |
|---|---|---|
| `/my-events` | ✅ | Registered event list with status |
| `/my-events/:registrationId/badge` | ✅ | Digital badge + QR code display |
| `/register/:eventId` | ✅ | Registration flow: ticket selection → personal info → payment |
| `/register/:eventId/payment-status` | ✅ | Post-payment success/failure page |
| `/events/[slug]/feed` | ✅ | Live event feed |
| `/events/[slug]/schedule` | ✅ | Session schedule + speaker bios |
| `/messages` | ✅ | 1:1 messaging with other participants/organizers |
| `/notifications` | ✅ | Notification inbox |
| `/profile` | ✅ | Edit profile (name, photo, bio) |
| `/settings` | ✅ | Language preference + notification opt-out |
| `/speaker/:eventId` | ⚠ partial | Speaker profile view |
| `/sponsor/:eventId` | ⚠ partial | Sponsor profile view |
| `/offline` | ✅ | Offline fallback page |

---

## Editorial design

The participant app has a distinct high-design aesthetic from the backoffice:

- **Serif display font** (Tiempos-like) for hero headings and event titles
- **navy → gold → forest gradient** background on hero
- **`EditorialEventCard`** from shared-ui: luxury-event aesthetic with branded gradient fallback when no cover photo
- **Dark mode** support throughout

---

## Event discovery

The home page and `/events` page fetch from `GET /v1/events` (SSR for first load, then React Query for client-side filtering). Features:

- **Category chips** — filter by conference, workshop, concert, festival, sport, networking
- **Search** — client-side title filter (Algolia integration planned for Wave 4+)
- **SSG** — event list pages are statically generated with ISR (revalidate every 60s for production)

---

## Registration flow

```
/events/[slug]  →  click "S'inscrire"
  └─► /register/:eventId
        ├── Step 1: Select ticket type (and promo code)
        ├── Step 2: Personal information
        ├── Step 3: Payment (if paid ticket)
        │     └─► Redirect to Wave/Orange Money
        │           └─► /register/:eventId/payment-status
        └── Step 4: Confirmation + badge link
```

For free tickets, steps 3 and 4 merge — registration is confirmed immediately.

---

## Authentication

Firebase Auth is **optional** for browsing but **required** for registration. The auth state is lazy — the site does not force a login wall on public pages.

Participants who are not verified via email cannot register for paid events (`isEmailVerified` check enforced at API level).

---

## SSR / SSG strategy

| Page type | Render strategy | Reason |
|---|---|---|
| Home (`/`) | SSG + ISR | SEO + fast first load |
| Event list (`/events`) | SSG + ISR | SEO for category pages |
| Event detail (`/events/[slug]`) | SSG + ISR per slug | SEO, WhatsApp OG preview |
| My events, profile, messages | CSR (authenticated) | No public SEO value, personalized |

Server-side API calls use `lib/server-api.ts` (Admin SDK or service account token). Client-side calls use `lib/api-client.ts` (Firebase Auth token).

---

## i18n

Framework: `next-intl`  
Languages: `fr` (default), `en`, `wo`  
Message files: `src/i18n/messages/{fr,en,wo}.json`

All public-facing strings (event categories, CTAs, navigation) are localized. User-generated content (event titles, descriptions) is stored as-is — no automatic translation.

---

## Development

```bash
cd apps/web-participant && npm run dev
# Starts on http://localhost:3002
```
