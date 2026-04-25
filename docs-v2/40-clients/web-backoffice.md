---
title: Web Back-office
status: shipped
last_updated: 2026-04-25
---

# Web Back-office

> **Status: ~85% shipped** — Core event management, check-in, analytics, badges, and communications are functional. Billing/payments UI is scaffolded.

App: `apps/web-backoffice/`  
Tech: Next.js 15, React 19, TypeScript, TailwindCSS, Firebase Auth, TanStack Query v5, Recharts, next-intl, next-themes

---

## Overview

The web back-office is a Progressive Web App (PWA) for event organizers and platform admins. It runs as the primary management tool on desktop and tablet.

**Base URL:** http://localhost:3001 (local)

---

## Route tree

### Public / auth

| Route | Purpose |
|---|---|
| `/login` | Email + password sign-in via Firebase Auth |
| `/forgot-password` | Send password reset email |
| `/verify-email` | Email verification prompt |

### Dashboard (organizer)

| Route | Status | Notes |
|---|---|---|
| `/dashboard` | ✅ | Stats: events, registrations, check-ins, revenue ("coming soon") |
| `/events` | ✅ | Event list with filters, pagination |
| `/events/new` | ✅ | Create event wizard |
| `/events/:id` | ✅ | Event detail hub (all tabs below) |
| `/events/:id/checkin` | ✅ | Live QR scan + real-time check-in dashboard + anomaly widget |
| `/events/:id/checkin/history` | ✅ | Full check-in log with filters |
| `/analytics` | ✅ (Pro+) | Time-series charts, top events, category breakdown |
| `/finance` | ⚠ partial | Balance + transaction ledger + payout history; revenue card is "coming soon" |
| `/notifications` | ✅ | All/unread/read notification center |
| `/badges` | ✅ (Starter+) | Badge template CRUD + bulk generation |
| `/communications` | ✅ | Broadcast composer with channel + recipient + schedule |
| `/venues` | ✅ | Venue CRUD |
| `/participants` | ✅ | Org-wide participant list |
| `/organization` | ✅ | Org profile settings |
| `/organization/billing` | 🔲 stub | Billing/plan management — largely placeholder |
| `/settings` | ✅ | User profile + language preference |

### Admin (super_admin only)

| Route | Status | Notes |
|---|---|---|
| `/admin` | ✅ | Platform stats dashboard |
| `/admin/users` | ✅ | User list + role editor + JWT/Firestore drift detection |
| `/admin/organizations` | ✅ | Org directory |
| `/admin/events` | ✅ | Platform-wide event list |
| `/admin/venues` | ✅ | Venue approval |
| `/admin/plans` | ✅ | Plan catalog CRUD |
| `/admin/plans/analytics` | ✅ | Plan adoption metrics |
| `/admin/audit` | ✅ | Audit log viewer |

---

## Event detail hub

The event detail page (`/events/:id`) is the most feature-rich page in the app. It has tabs:

| Tab | Feature | Plan |
|---|---|---|
| **Overview** | Event metadata edit form | All |
| **Inscriptions** | Registration list + approve/reject/export | All / Starter+ (export) |
| **Billets** | Ticket type CRUD | All |
| **Zones** | Access zone CRUD | All |
| **Sessions** | Agenda/session CRUD | All |
| **Check-in** | Live QR scan, duplicate-scan detection, anomaly widget | Starter+ |
| **Speakers** | Speaker CRUD | Pro+ |
| **Sponsors** | Sponsor CRUD + leads | Pro+ |
| **Codes promo** | Promo code CRUD | Starter+ |
| **Feed** | Event feed posts + moderation | All |
| **Communications** | Broadcast targeting this event | All |
| **Badges** | Badge generation + template | Starter+ |
| **Paiements** | Payment ledger for this event | All |

---

## Authentication & session

- Firebase Auth email/password
- Session idle timeout: **60 minutes** with a 5-minute warning toast
- Auth context: `AuthProvider` in `src/providers/auth-provider.tsx`
- JWT custom claims: `roles[]`, `organizationId`, `orgRole`
- Role check: `useAuth().hasRole('super_admin')`

---

## Data fetching

TanStack Query is used for all server state. Key hooks:

| Hook | Data |
|---|---|
| `useEvents(orgId)` | Event list for org |
| `useEvent(eventId)` | Single event |
| `useEventRegistrations(eventId)` | Registration list |
| `useOrgAnalytics({ orgId, timeframe })` | Analytics data |
| `useBadgeTemplates(orgId)` | Badge templates |
| `useNotifications()` | Notification inbox |
| `usePlanGating()` | Plan/feature check helpers |

API client: `src/lib/api-client.ts` — automatically injects Firebase ID token in `Authorization` header.

---

## Plan gating

Features are gated with `<PlanGate>`:

```tsx
<PlanGate feature="advancedAnalytics" fallback="blur">
  <AnalyticsDashboard />
</PlanGate>
```

And with the `usePlanGating()` hook for conditional rendering in code.

---

## i18n

Framework: `next-intl`  
Languages: `fr` (default), `en`, `wo`  
Message files: `src/i18n/messages/{fr,en,wo}.json`  
Locale switcher: `<LanguageSwitcher />` from `@teranga/shared-ui`

---

## PWA

- Manifest: `public/manifest.json` (standalone mode, navy theme, start_url: `/login`)
- Service worker: next-pwa plugin
- Icons: 192×512 PNG in `public/`

---

## Development

```bash
npm run web:dev
# or
cd apps/web-backoffice && npm run dev
# Starts on http://localhost:3001 with 0.0.0.0 binding (WSL2 compatible)
```
