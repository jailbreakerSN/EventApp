# Teranga — Delivery Plan

## Overview

The Teranga platform delivery is organized into **10 waves + 1 MVP sprint**, each building on the previous one and producing a deployable increment. Every wave ends with a working, testable product that can be demonstrated to stakeholders.

**Total estimated timeline:** ~18 weeks (flexible, wave-by-wave)

### MVP Strategy: Web-First → Dakar Launch Sprint

The MVP prioritizes the **web platform** (participant web app + organizer backoffice) over the mobile app. Mobile is deferred to Wave 9 after the web experience is validated with real organizers in Dakar.

After completing Waves 1-8 (backend + web frontends), the **MVP Launch Sprint** bridges the gap between "code complete" and "market ready" by integrating real providers, adding quick-win features, and hardening for production.

**Rationale:**
- **SEO**: Event discovery must be Google-indexed for promotion
- **WhatsApp sharing**: Rich link previews require server-rendered HTML with OG tags
- **Faster iteration**: Web deploys instantly vs app store review cycles
- **Market validation**: Prove the product works before investing in native mobile
- **Mobile app becomes the premium layer**: Adds offline QR scanning, push notifications, and native UX

## Current State (as of 2026-04-07, post-audit)

| Component | Completion | Notes |
|-----------|-----------|-------|
| Shared Types | ~99% | Zod schemas: all entities, promo codes, phone validation |
| API (Fastify) | ~98% | Waves 1-8 + MVP Sprint, 337 tests across 27 files. Real providers ready (Wave/OM/AT/Resend+SendGrid) |
| Cloud Functions | ~95% | Auth, badge, check-in, payment lifecycle, scheduled reminders |
| Web Backoffice | ~92% | All tabs, promo codes, bulk approve, file upload component |
| Web Participant | ~92% | Discovery, registration, badges, share buttons, SEO, speaker/sponsor portals |
| Mobile (Flutter) | ~35% | Wave 1 basics; full app deferred to Wave 9 |
| Shared UI | ~70% | Button, Card, Input, Badge, Spinner + utility functions |
| Infrastructure | ~97% | Firestore rules, indexes, hosting, emulators, comprehensive seed script |

### Honest Wave Assessment (Post-Audit)

| Wave | Name | Plan Status | Real Status | Gap |
|------|------|------------|-------------|-----|
| Pre-Wave | Foundation Hardening | `completed` | ✅ 100% | — |
| Wave 1 | Core Loop | `completed` | ✅ 98% | CSV export deferred |
| Wave 2 | Check-in & Dashboard | `completed` | ✅ 95% | Mobile scanner → Wave 9 |
| Wave 3 | Participant Web App | `completed` | ✅ 95% | Lighthouse perf verification pending |
| Wave 4 | Organizer Productivity | `completed` | ✅ 90% | Co-organizer roles, CSV export deferred |
| Wave 5 | Feed, Messaging, Sessions | `completed` | ✅ 92% | Mobile screens → Wave 9 |
| Wave 6 | Payments | `completed` | ✅ 90% | Wave + OM providers ready, payment lifecycle Cloud Functions |
| Wave 7 | Communications | `completed` | ✅ 85% | AT SMS + SendGrid email providers, templates, reminders |
| Wave 8 | Portals | `completed` | ✅ 85% | Speaker + sponsor self-service portals, file upload |
| **MVP Sprint** | **Dakar Launch** | `completed` | ✅ 95% | Real providers, SEO, promo codes, Cloud Functions |
| Wave 9 | Mobile App | `not_started` | ❌ 0% | Post-MVP validation |
| Wave 10 | Production Hardening | `not_started` | ❌ 0% | Merged into MVP Sprint + post-launch |

## Wave Progress

| Wave | Name | Platform | Status | File |
|------|------|----------|--------|------|
| Pre-Wave | Foundation Hardening | All | `completed` | [wave-0-prerequisites.md](wave-0-prerequisites.md) |
| Wave 1 | Core Loop — Create, Register, Badge | API + Web + Mobile | `completed` | [wave-1-core-loop.md](wave-1-core-loop.md) |
| Wave 2 | Check-in API & Web Dashboard | API + Web | `completed` | [wave-2-offline-checkin.md](wave-2-offline-checkin.md) |
| Wave 3 | Participant Web App | Web | `completed` | [wave-3-participant-web.md](wave-3-participant-web.md) |
| Wave 4 | Organizer Productivity | API + Web | `completed` | [wave-4-organizer-tools.md](wave-4-organizer-tools.md) |
| Wave 5 | Feed, Messaging, Sessions | API + Web | `completed` | [wave-5-social-sessions.md](wave-5-social-sessions.md) |
| Wave 6 | Payments | API + Web | `partial` | [wave-6-payments.md](wave-6-payments.md) |
| Wave 7 | SMS, Email, Communication | API + Web | `partial` | [wave-7-communications.md](wave-7-communications.md) |
| Wave 8 | Sponsor & Speaker Portals | API + Web | `partial` | [wave-8-portals.md](wave-8-portals.md) |
| **MVP Sprint** | **Dakar Launch Sprint** | **All (Web)** | `in_progress` | [mvp-launch-sprint.md](mvp-launch-sprint.md) |
| Wave 9 | Mobile App Completion | Mobile | `not_started` | [wave-9-mobile-app.md](wave-9-mobile-app.md) |
| Wave 10 | Production Hardening & Launch | All | `not_started` | [wave-10-launch.md](wave-10-launch.md) |

**Status values:** `not_started` | `in_progress` | `partial` | `completed` | `blocked`

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
10. **Real providers before launch** — no mock providers in production; integrate Wave, Africa's Talking, SendGrid before going live

## Architecture Reference

See [CLAUDE.md](../../CLAUDE.md) for full architecture documentation.

## Future Roadmap (Post-Wave 10)

See [future-roadmap.md](future-roadmap.md) for post-launch feature ideas.
