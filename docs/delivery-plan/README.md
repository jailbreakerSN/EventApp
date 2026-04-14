# Teranga — Delivery Plan

## Overview

The Teranga platform delivery is organized into **10 waves + 1 MVP sprint + 1 UX/UI audit**, each building on the previous one and producing a deployable increment. Every wave ends with a working, testable product that can be demonstrated to stakeholders.

**Total estimated timeline:** ~18 weeks (flexible, wave-by-wave)

### MVP Strategy: Web-First → Dakar Launch Sprint

The MVP prioritizes the **web platform** (participant web app + organizer backoffice) over the mobile app. Mobile is deferred to Wave 9 after the web experience is validated with real organizers in Dakar.

**Rationale:**

- **SEO**: Event discovery must be Google-indexed for promotion
- **WhatsApp sharing**: Rich link previews require server-rendered HTML with OG tags
- **Faster iteration**: Web deploys instantly vs app store review cycles
- **Market validation**: Prove the product works before investing in native mobile
- **Mobile app becomes the premium layer**: Adds offline QR scanning, push notifications, and native UX

---

## Current State (as of 2026-04-12)

| Component        | Completion | Notes                                                                                                                                                                                                      |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Types     | ~99%       | 18 Zod schema files: all entities, venues, promo codes, phone validation, subscriptions                                                                                                                    |
| API (Fastify)    | **~99%**   | 26 route files, 32 services, **558 tests (39 files)**. All services have test coverage. Security hardening applied.                                                                                        |
| Cloud Functions  | **~97%**   | Auth, badge, check-in, payment lifecycle, scheduled reminders. **All 14 triggers standardized** (memory/timeout).                                                                                          |
| Web Backoffice   | **~99%**   | All pages + super admin + billing + command palette + WCAG AA. **QueryError, error boundaries, semantic badges, responsive tables, idle timeout, CSV export, i18n infrastructure, eslint-plugin-jsx-a11y** |
| Web Participant  | **~98%**   | Discovery + filters, registration, badges, portals, markdown, newsletter, WCAG AA. **Error boundaries, QueryError, badge offline caching, idle timeout, i18n infrastructure**                              |
| Shared UI        | **~97%**   | **20 components**: + QueryError, + responsive DataTable card mode, + semantic Badge variants (info, pending, neutral, premium), + getStatusVariant()                                                       |
| Mobile (Flutter) | ~35%       | Wave 1 basics; full app deferred to Wave 9                                                                                                                                                                 |
| Infrastructure   | **~98%**   | Firestore rules, indexes, hosting, emulators, seed script. **+ CI for web-participant, + staging deploy workflow, + Dockerfile hardening, + Firestore rules test infrastructure**                          |
| CI/CD            | **~95%**   | **All 7 apps in CI pipeline** (was 6). Staging deploy workflow. eslint-plugin-jsx-a11y for accessibility linting.                                                                                          |

### Wave Assessment (Post UX/UI Audit — 2026-04-08)

| Wave               | Name                              | Status          | Completion | Notes                                                                                                                                |
| ------------------ | --------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-Wave           | Foundation Hardening              | `completed`     | 100%       | —                                                                                                                                    |
| Wave 1             | Core Loop                         | `completed`     | 98%        | CSV export deferred                                                                                                                  |
| Wave 2             | Check-in & Dashboard              | `completed`     | 95%        | Mobile scanner → Wave 9                                                                                                              |
| Wave 3             | Participant Web App               | `completed`     | 97%        | +filters, markdown, similar events, newsletter                                                                                       |
| Wave 4             | Organizer Productivity            | `completed`     | 95%        | +command palette, keyboard shortcuts, breadcrumbs                                                                                    |
| Wave 5             | Feed, Messaging, Sessions         | `completed`     | 92%        | Mobile screens → Wave 9                                                                                                              |
| Wave 6             | Payments                          | `completed`     | 90%        | Wave + OM providers ready, payment lifecycle                                                                                         |
| Wave 7             | Communications                    | `completed`     | 85%        | AT SMS + Resend email, templates, reminders                                                                                          |
| Wave 8             | Portals                           | `completed`     | 85%        | Speaker + sponsor self-service portals                                                                                               |
| MVP Sprint         | Dakar Launch                      | `completed`     | 95%        | Real providers, SEO, promo codes, Cloud Functions                                                                                    |
| **UX/UI Audit**    | **4-Phase Polish**                | **`completed`** | **100%**   | **97 files, ~4300 lines, WCAG AA, 17 shared-ui components**                                                                          |
| **Super Admin**    | **Platform Administration**       | **`completed`** | **95%**    | **Admin dashboard, user/org/event management, audit logs, venue lifecycle**                                                          |
| **Venue Host**     | **Venue Entity + Host Dashboard** | **`completed`** | **100%**   | **Venue CRUD, event-venue link, admin venues, host dashboard, venue selector in event creation, participant venue display**          |
| **Freemium**       | **Plan Gating + Billing**         | **`completed`** | **95%**    | **4 tiers (free/starter/pro/enterprise), 11 feature flags, API enforcement, billing page, plan comparison, upgrade/downgrade**       |
| **Platform Audit** | **Full Repo Audit & Remediation** | **`completed`** | **95%**    | **558 tests, CI for all apps, security fixes, error boundaries, i18n infra, a11y, responsive tables, offline badges, status tokens** |
| Wave 9             | Mobile App                        | `not_started`   | 0%         | Post-MVP validation                                                                                                                  |
| Wave 10            | Production Hardening              | `not_started`   | 0%         | Next priority                                                                                                                        |

### UX/UI Audit Summary (2026-04-07 → 2026-04-08)

| Phase   | Focus                | Commit               | Files | Key Deliverables                                                   |
| ------- | -------------------- | -------------------- | ----- | ------------------------------------------------------------------ |
| Phase 1 | Critical fixes       | `167fd10`            | 27    | 17 shared-ui components, responsive sidebar, forgot password, ARIA |
| Phase 2 | UX enhancements      | `538a48e`            | 12    | Event filters, skeleton loaders, tab persistence, dashboard trends |
| Phase 3 | Content & navigation | `918e968`            | 29    | Footer, breadcrumbs, markdown, similar events, form validation     |
| Phase 4 | Competitive features | `457baa6`            | 29    | Command palette, keyboard shortcuts, WCAG AA, newsletter, ISR      |
| Fixes   | Hydration + loading  | `7d9515b`, `bfb905b` | 14    | ThemeToggle fix, branded logo loading screens                      |

### Super Admin Panel + Venue Host Platform (2026-04-08)

A two-part feature set that adds platform-wide administration and introduces venues as first-class entities linked to events. The venue host strategy is a **go-to-market lever**: ~20-30 major Dakar venues host 80% of professional events. If they recommend Teranga to organizers booking their space, it becomes an organic distribution channel.

**What was built:**

| Phase   | Scope                                                       | Status      | Key Deliverables                                                                                                                                                                          |
| ------- | ----------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | Types + Admin API + Admin UI                                | `completed` | 7 venue permissions, `venue_manager` role, admin repository/service/routes, 7 admin pages (dashboard, users, orgs, events, venues, audit), sidebar admin section, command palette entries |
| Phase 2 | Venue Entity + Venue API + Event-Venue Link                 | `completed` | Venue repository/service/routes (8 endpoints), `venueId`/`venueName` on Event, venue counter management, admin venues page with real data                                                 |
| Phase 3 | Venue Host Dashboard + Event Creation + Participant Display | `completed` | Venue host pages (/venues, /venues/[id]), venue selector in event creation, participant "Lieu référencé" badge                                                                            |

**Key architecture decisions:**

- Admin routes at `/v1/admin/*` with single `requirePermission("platform:manage")` gate
- `venue_manager` as organization-scoped role via `hostOrganizationId` on venue
- Denormalized `venueName` on Event (same pattern as `eventTitle` on Registration)
- Venue `eventCount` as denormalized counter using `BaseRepository.increment()`
- Admin syncs both Firestore user doc AND Firebase Auth custom claims on role changes

**Files added:** 8 new backend files (repository, service, routes, domain events, audit listeners), 10 new frontend files (hooks, 7 admin pages, layout, venue hooks)
**Files modified:** 13 files across shared-types, API, and web-backoffice

### Freemium Model (2026-04-11)

A 4-phase implementation adding a complete SaaS freemium monetization model with 4 plan tiers, API-level enforcement, frontend gating, and a billing management page.

**Plan Tiers (XOF pricing):**

|                    | Free  | Starter (9 900/mo)      | Pro (29 900/mo)                        | Enterprise (custom) |
| ------------------ | ----- | ----------------------- | -------------------------------------- | ------------------- |
| Events             | 3     | 10                      | Unlimited                              | Unlimited           |
| Participants/event | 50    | 200                     | 2,000                                  | Unlimited           |
| Members            | 1     | 3                       | 50                                     | Unlimited           |
| Features           | Basic | +QR, badges, CSV, promo | +Paid tickets, SMS, analytics, portals | +API, white-label   |

**What was built:**

| Phase   | Scope                               | Status      | Key Deliverables                                                                                                                                                                   |
| ------- | ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | Shared types + API enforcement      | `completed` | `PlanFeatures` (11 flags), `PlanLimits` expansion, `requirePlanFeature()`, event creation/clone limit checks, paid ticket gating, registration participant limit with grace period |
| Phase 2 | Subscription management + usage API | `completed` | Subscription service/repository/routes, usage on-demand computation, upgrade/downgrade/cancel, subscription schema in shared-types                                                 |
| Phase 3 | Frontend plan gating                | `completed` | `PlanGate` component (blur/hidden/disabled), `UsageMeter`, `UpgradeBanner`, sidebar plan widget, analytics blur gate, SMS disable gate                                             |
| Phase 4 | Billing page + upgrade flow         | `completed` | Billing page, `PlanComparisonTable` (responsive), `UpgradeDialog`/`UpgradePreview`, subscription hooks with cache invalidation                                                     |

**Key architecture decisions:**

- Per-event participant limit (not org-wide) — cheaper to check, more intuitive
- On-demand usage computation (no counters collection) — avoids transactional overhead
- Grace period for live events — never block registrations after event starts
- Instant upgrade without payment for MVP — payment integration (Wave/OM) comes later
- Soft walls (blur + upgrade CTA) over hard walls — better UX conversion
- Plan config as typed data in shared-types — both API and frontend import `PLAN_LIMITS` directly

**Files added:** 11 new files (shared-types subscription schema, API subscription service/repository/routes, 6 frontend components/hooks/pages)
**Files modified:** 14 files across shared-types, API, and web-backoffice
**Tests:** 30 new plan-limits tests (401 total)
**Seed data:** 4 organizations across all plan tiers (free, starter, pro, enterprise) with 3 subscription documents

---

## What Remains: Path to Production Launch

The web platform is feature-complete at ~98%. What remains is **production hardening, legal compliance, launch preparation, and venue host UX** — not new core features.

### Remaining Work: 3 Phases

```
Current state ──────────────────────────────────────────────────────►
  └── Phase A: Launch Blockers (3-5 days)
  └── Phase B: Production Infrastructure (1 week)
  └── Phase C: Beta & Launch (1 week)
                                                          │
                                                          └── tag v1.0.0-beta
                                                          └── beta with 5-10 Dakar organizers
```

---

### Phase A: Launch Blockers (3-5 days)

Items that **must** exist before any real user touches the product.

#### A1. Legal Pages (Participant App)

- [ ] Privacy policy page (`/privacy`) — GDPR-aligned, French, covers data collection, payment data, cookies
- [ ] Terms of service page (`/terms`) — Platform rules, organizer responsibilities, refund policy
- [ ] Legal mentions page (`/legal`) — Company info, NINEA, hosting provider
- [ ] Cookie consent banner (if applicable under Senegalese regulations)
- **Why:** Footer links to these pages already exist but lead to 404s

#### A2. Email Verification on Signup

- [ ] Send verification email after registration (Firebase `sendEmailVerification()`)
- [ ] Show "Vérifiez votre email" screen after signup
- [ ] Gate authenticated actions behind verified email (soft gate — show banner, don't block)
- **Why:** Prevents fake accounts and ensures communication channel works

#### A3. Error & Empty States Polish

- [ ] Consistent 404 page for both apps (branded, with navigation back)
- [ ] Global error boundary with retry button and French copy
- [ ] Empty states on all list pages (icon + descriptive text + CTA where applicable)
- [ ] Network error handling (offline banner: "Connexion perdue")
- **Why:** Real users will hit edge cases; raw errors destroy trust

#### A4. CSV Export UI (Backoffice)

- [ ] "Exporter CSV" button on participants list page
- [ ] "Exporter CSV" button on registrations tab in event detail
- [ ] Wire to existing API endpoints (already implemented)
- **Why:** Organizers need offline data for event day coordination

#### A5. Landing Page Enhancement (Participant Homepage)

- [ ] Testimonials/social proof section (placeholder for beta quotes)
- [ ] "Comment ça marche" section (3-step: Découvrir → S'inscrire → Participer)
- [ ] CTA for organizers: "Vous organisez un événement ? Créez-le gratuitement"
- [ ] Stats section (placeholder: "X événements", "X participants", "X villes")
- **Why:** Homepage is the first impression; needs to convert visitors

#### A6. Service Worker & Offline Badge

- [ ] Service worker for participant app (cache badge QR for offline display)
- [ ] PWA manifest for both apps (installable on mobile)
- [ ] Offline fallback page ("Vous êtes hors ligne")
- **Why:** Critical for the African market — badges must display without network at venue

---

### Phase B: Production Infrastructure (1 week)

Infrastructure and ops work required to run reliably in production.

#### B1. Production Environment Setup

- [ ] Firebase production project (`teranga-events-prod`)
- [ ] Custom domains: `teranga.sn` (participant), `app.teranga.sn` (backoffice)
- [ ] SSL certificates (auto via Firebase Hosting)
- [ ] Cloud Run deployment with min 1 instance (no cold starts)
- [ ] Environment variables configured (payment keys, SMS keys, email keys)
- [ ] Firebase indexes deployed to production

#### B2. Monitoring & Error Tracking

- [ ] Sentry integration (or Firebase Crashlytics for web) — capture JS errors + API errors
- [ ] Uptime monitoring (UptimeRobot or similar) for API, participant app, backoffice
- [ ] Alert rules: 5xx rate > 1%, API latency p95 > 2s, auth failures spike
- [ ] Structured logging in API (requestId, userId, duration in every log line)

#### B3. Performance Optimization

- [ ] Lighthouse audit: target > 90 on Performance, Accessibility, SEO
- [ ] Image optimization (next/image already used, verify quality/format settings)
- [ ] Bundle analysis (identify and code-split heavy dependencies)
- [ ] API response time benchmarks (< 200ms p95 for registration and check-in)
- [ ] Firestore query audit (review all queries, ensure composite indexes)

#### B4. Security Hardening

- [ ] CORS configuration for production domains only
- [ ] CSP headers on both web apps
- [ ] Rate limiting fine-tuning (registration: 10/min/IP, check-in: 100/min/user)
- [ ] Firestore security rules test suite (automated, not just manual)
- [ ] Secret rotation procedure documented
- [ ] API key scoping (restrict Firebase API keys to production domains)

#### B5. Backup & Recovery

- [ ] Firestore scheduled exports to GCS (daily)
- [ ] Backup restoration procedure documented and tested
- [ ] Data retention policy (how long to keep registrations, payments, audit logs)

#### B6. CI/CD Pipeline

- [ ] GitHub Actions: lint → test → build → deploy on push to main
- [ ] Staging environment for pre-production testing
- [ ] Deploy preview for PRs (Firebase Hosting preview channels)

---

### Phase C: Beta & Launch (1 week)

#### C1. Beta Program

- [ ] Seed production with 2-3 test events (real event data, not "test")
- [ ] Invite 5-10 Dakar organizers for beta testing
- [ ] Create WhatsApp group for beta feedback
- [ ] Prepare onboarding guide in French (PDF or Notion page)
- [ ] Track beta metrics: events created, registrations, check-in rate, payment success rate

#### C2. Provider Production Keys

- [ ] Wave Business API production keys obtained and configured
- [ ] Orange Money API production keys obtained and configured
- [ ] Africa's Talking production account with SMS credits for Senegal
- [ ] Resend production account with verified sender domain (`@teranga.sn`)

#### C3. Launch Preparation

- [ ] Define launch metrics (DAU, events created, registrations, payment conversion)
- [ ] Support workflow: who handles bug reports, payment issues, organizer questions?
- [ ] On-call runbook for common issues (payment stuck, badge not generated, check-in sync failure)
- [ ] Google Search Console verification + sitemap submission
- [ ] Social media presence (placeholder accounts already in footer)

#### C4. Documentation

- [ ] Organizer quickstart guide (French): "Créer votre premier événement en 5 minutes"
- [ ] API documentation (auto-generated from Fastify/Swagger — verify completeness)
- [ ] Internal runbook: deployment procedure, rollback steps, monitoring dashboards

---

## Post-Launch Roadmap

After successful beta with Dakar organizers, the roadmap shifts to growth and expansion.

### Wave 9: Mobile App (3-4 weeks) — Post-Beta Validation

- [ ] Flutter app completion (offline QR scanner, push notifications, full feature parity)
- [ ] App Store + Play Store submission
- [ ] Deep linking (event URLs → app)
- [ ] Crash reporting (Firebase Crashlytics)
- [ ] Offline-first architecture (Hive + Firestore offline)

### Growth Features (Quarter 1 Post-Launch)

| Feature                                 | Priority | Impact                 | Effort   |
| --------------------------------------- | -------- | ---------------------- | -------- |
| Post-event surveys & ratings            | High     | Organizer retention    | 1 week   |
| Certificates of attendance              | High     | Participant value      | 3-5 days |
| Recurring events                        | High     | Organizer productivity | 1 week   |
| Co-organizer roles UI                   | High     | Team collaboration     | 3-5 days |
| Custom registration form builder        | Medium   | Organizer flexibility  | 2 weeks  |
| Payout execution (actual bank transfer) | Medium   | Revenue completion     | 1 week   |
| Waitlist automation                     | Medium   | Capacity optimization  | 3-5 days |
| Map view for event discovery            | Medium   | Participant UX         | 1 week   |
| Multi-language content (FR/EN/WO)       | Medium   | Market expansion       | 2 weeks  |
| Webhook system for organizers           | Low      | Developer ecosystem    | 1 week   |
| Multi-currency (XAF, NGN)               | Low      | Regional expansion     | 1 week   |
| White-label / custom branding           | Low      | Enterprise tier        | 2 weeks  |
| AI event description generator          | Low      | Organizer convenience  | 3-5 days |

---

## Complete Event Lifecycle Coverage

The table below maps every stage of the event lifecycle to its implementation status:

### Organizer Journey

| Stage          | Feature                                          | Status                           |
| -------------- | ------------------------------------------------ | -------------------------------- |
| **Create**     | Select venue from directory (auto-fill location) | ✅ Done                          |
| **Create**     | Event creation wizard (4 steps)                  | ✅ Done                          |
| **Create**     | Ticket types (free + paid, XOF)                  | ✅ Done                          |
| **Create**     | Access zones (multi-entry)                       | ✅ Done                          |
| **Create**     | Promo codes (% and fixed)                        | ✅ Done                          |
| **Create**     | Event cover image upload                         | ✅ Done                          |
| **Configure**  | Speaker invitations                              | ✅ Done                          |
| **Configure**  | Sponsor invitations + tiers                      | ✅ Done                          |
| **Configure**  | Session schedule builder                         | ✅ Done                          |
| **Configure**  | Badge template customization                     | ✅ Done                          |
| **Publish**    | Publish/unpublish toggle                         | ✅ Done                          |
| **Promote**    | SEO (sitemap, JSON-LD, OG tags)                  | ✅ Done                          |
| **Promote**    | WhatsApp/Facebook/Twitter share                  | ✅ Done                          |
| **Manage**     | Registration dashboard                           | ✅ Done                          |
| **Manage**     | Approve/reject/waitlist                          | ✅ Done                          |
| **Manage**     | Broadcast communications                         | ✅ Done                          |
| **Manage**     | CSV export                                       | 🔧 API done, UI pending          |
| **Revenue**    | Payment dashboard                                | ✅ Done                          |
| **Revenue**    | Refund processing                                | ✅ Done                          |
| **Revenue**    | Payout calculation                               | ✅ Done                          |
| **Revenue**    | Payout execution                                 | ❌ Post-launch                   |
| **Event Day**  | Check-in dashboard                               | ✅ Done                          |
| **Event Day**  | Offline QR scanning                              | ✅ Done (web)                    |
| **Event Day**  | Live feed & announcements                        | ✅ Done                          |
| **Post-Event** | Analytics & reports                              | ✅ Done                          |
| **Post-Event** | Surveys & ratings                                | ❌ Post-launch                   |
| **Post-Event** | Certificates                                     | ❌ Post-launch                   |
| **Billing**    | View current plan & usage                        | ✅ Done                          |
| **Billing**    | Compare plans (4 tiers, XOF pricing)             | ✅ Done                          |
| **Billing**    | Upgrade/downgrade plan                           | ✅ Done                          |
| **Billing**    | Cancel subscription                              | ✅ Done                          |
| **Billing**    | Feature gating (blur/disable/hide)               | ✅ Done                          |
| **Billing**    | Usage meters (events, members)                   | ✅ Done                          |
| **Billing**    | Payment integration (Wave/OM)                    | 🔧 MVP instant, payments pending |

### Participant Journey

| Stage          | Feature                            | Status                    |
| -------------- | ---------------------------------- | ------------------------- |
| **Discover**   | Browse/search events               | ✅ Done                   |
| **Discover**   | Filter by date/city/price/category | ✅ Done                   |
| **Discover**   | Similar events recommendations     | ✅ Done                   |
| **Discover**   | Newsletter signup                  | ✅ Done                   |
| **Register**   | Free registration                  | ✅ Done                   |
| **Register**   | Paid registration (Wave/OM)        | ✅ Done                   |
| **Register**   | Promo code application             | ✅ Done                   |
| **Prepare**    | Badge QR display                   | ✅ Done                   |
| **Prepare**    | Add to Calendar (GCal + .ics)      | ✅ Done                   |
| **Prepare**    | SMS/email reminders (24h + 1h)     | ✅ Done                   |
| **Prepare**    | Offline badge display              | 🔧 Service worker pending |
| **Event Day**  | Show badge at check-in             | ✅ Done                   |
| **Event Day**  | View session schedule              | ✅ Done                   |
| **Event Day**  | Participate in feed                | ✅ Done                   |
| **Post-Event** | Rate event/speakers                | ❌ Post-launch            |
| **Post-Event** | Download certificate               | ❌ Post-launch            |

### Speaker Journey

| Stage          | Feature                          | Status         |
| -------------- | -------------------------------- | -------------- |
| **Invite**     | Receive & accept invitation      | ✅ Done        |
| **Setup**      | Edit profile (bio, photo, links) | ✅ Done        |
| **Prepare**    | View assigned sessions           | ✅ Done        |
| **Prepare**    | Upload presentation slides       | ✅ Done        |
| **Event Day**  | Post to event feed               | ✅ Done        |
| **Post-Event** | View attendee feedback           | ❌ Post-launch |

### Sponsor Journey

| Stage          | Feature                              | Status  |
| -------------- | ------------------------------------ | ------- |
| **Invite**     | Receive & accept invitation          | ✅ Done |
| **Setup**      | Configure booth (title, CTA, banner) | ✅ Done |
| **Event Day**  | Scan attendee badges (lead capture)  | ✅ Done |
| **Event Day**  | Add notes/tags to leads              | ✅ Done |
| **Post-Event** | Export leads CSV                     | ✅ Done |
| **Post-Event** | Lead analytics                       | ✅ Done |

### Venue Host Journey

| Stage         | Feature                                               | Status                         |
| ------------- | ----------------------------------------------------- | ------------------------------ |
| **Onboard**   | Register as venue_manager                             | ✅ Done (role exists)          |
| **Setup**     | Create venue (name, address, type, amenities, photos) | ✅ Done (API)                  |
| **Setup**     | Venue approval workflow (pending → approved)          | ✅ Done                        |
| **Manage**    | Update venue details                                  | ✅ Done (API)                  |
| **Manage**    | View events hosted at venue                           | ✅ Done (API)                  |
| **Manage**    | Venue host dashboard (backoffice)                     | ✅ Done                        |
| **Analytics** | Venue event count, registrations                      | ✅ Done (denormalized counter) |
| **Promote**   | Featured venue status                                 | ✅ Done (admin toggle)         |

### Super Admin Journey

| Stage             | Feature                                              | Status  |
| ----------------- | ---------------------------------------------------- | ------- |
| **Dashboard**     | Platform KPIs (users, orgs, events, revenue, venues) | ✅ Done |
| **Users**         | List, search, filter by role                         | ✅ Done |
| **Users**         | Change roles, suspend/activate                       | ✅ Done |
| **Organizations** | List, verify, suspend                                | ✅ Done |
| **Events**        | Cross-org event oversight                            | ✅ Done |
| **Venues**        | Approve/suspend venues, view all venues              | ✅ Done |
| **Audit**         | Query audit logs by action/date                      | ✅ Done |

### Staff/Scanner Journey

| Stage      | Feature                       | Status  |
| ---------- | ----------------------------- | ------- |
| **Setup**  | Sync offline data             | ✅ Done |
| **Scan**   | QR code scanning (web camera) | ✅ Done |
| **Scan**   | Access zone selection         | ✅ Done |
| **Scan**   | Offline scanning + buffering  | ✅ Done |
| **Scan**   | Conflict resolution           | ✅ Done |
| **Review** | Check-in history & stats      | ✅ Done |

---

## Architecture Reference

See [CLAUDE.md](../../CLAUDE.md) for full architecture documentation.

## Future Roadmap (Post-Launch)

See [future-roadmap.md](future-roadmap.md) for post-launch feature ideas.

## Wave Files

| Wave                     | File                                                           |
| ------------------------ | -------------------------------------------------------------- |
| Pre-Wave                 | [wave-0-prerequisites.md](wave-0-prerequisites.md)             |
| Wave 1                   | [wave-1-core-loop.md](wave-1-core-loop.md)                     |
| Wave 2                   | [wave-2-offline-checkin.md](wave-2-offline-checkin.md)         |
| Wave 3                   | [wave-3-participant-web.md](wave-3-participant-web.md)         |
| Wave 4                   | [wave-4-organizer-tools.md](wave-4-organizer-tools.md)         |
| Wave 5                   | [wave-5-social-sessions.md](wave-5-social-sessions.md)         |
| Wave 6                   | [wave-6-payments.md](wave-6-payments.md)                       |
| Wave 7                   | [wave-7-communications.md](wave-7-communications.md)           |
| Wave 8                   | [wave-8-portals.md](wave-8-portals.md)                         |
| MVP Sprint               | [mvp-launch-sprint.md](mvp-launch-sprint.md)                   |
| UX/UI Audit (current)    | [audit-2026-04-13.md](../design-system/audit-2026-04-13.md) + [execution-plan-2026-04-13.md](../design-system/execution-plan-2026-04-13.md) |
| UX/UI Audit (historical) | [ux-ui-audit-2026-04-07.md](../../docs/ux-ui-audit-2026-04-07.md) (superseded), [roadmap-2026-04-13.md](../design-system/roadmap-2026-04-13.md) (superseded) |
| Super Admin + Venue Host | _(plan in `.claude/plans/`)_                                   |
| Freemium Model           | _(plan in `.claude/plans/compiled-strolling-backus.md`)_       |
| Wave 9                   | [wave-9-mobile-app.md](wave-9-mobile-app.md)                   |
| Wave 10                  | [wave-10-launch.md](wave-10-launch.md)                         |

---

## Delivery Principles

1. **Each wave is independently deployable** — stakeholders can test after every wave
2. **Web-first MVP** — participant web app and backoffice are the priority; mobile comes after web validation
3. **API-first** — backend endpoints land before frontend consumes them
4. **Shared types are the contract** — Zod schemas updated first, then API + clients
5. **SEO for event discovery** — public event pages must be server-rendered and Google-indexable
6. **Tests accompany every feature** — unit tests for services, integration tests for routes
7. **Security at every layer** — Firestore rules, API middleware, input validation
8. **Francophone-first** — French is the default language for all user-facing strings
9. **Mobile = premium layer** — offline QR scanning, push notifications, and native UX on top of proven web product
10. **Real providers before launch** — no mock providers in production
