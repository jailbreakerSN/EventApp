# Teranga — Delivery Plan

## Overview

The Teranga platform delivery is organized into **10 waves**, each building on the previous one and producing a deployable increment. Every wave ends with a working, testable product that can be demonstrated to stakeholders.

**Total estimated timeline:** ~18 weeks (flexible, wave-by-wave)

### MVP Strategy: Web-First

The MVP prioritizes the **web platform** (participant web app + organizer backoffice) over the mobile app. Mobile is deferred to Wave 9 after the web experience is validated. Rationale:
- **SEO**: Event discovery must be Google-indexed for promotion (impossible with Flutter Web)
- **WhatsApp sharing**: Rich link previews require server-rendered HTML with OG tags
- **Faster iteration**: Web deploys instantly vs app store review cycles
- **Market validation**: Prove the product works before investing in native mobile
- **Mobile app becomes the premium layer**: Adds offline QR scanning, push notifications, and native UX on top of a proven web product

## Current State (as of 2026-04-07)

| Component | Completion | Notes |
|-----------|-----------|-------|
| Shared Types | ~99% | Zod schemas, permissions, invites, analytics, clone, sessions, feed, messaging DTOs |
| API (Fastify) | ~99% | Waves 1-5 endpoints, session/feed/messaging services, 224 tests |
| Cloud Functions | ~80% | Auth triggers, badge generation, registration triggers, check-in feed trigger |
| Web Backoffice | ~98% | Full event CRUD, registrations, check-in, org settings, sessions, feed, analytics |
| Web Participant | ~95% | SSG/ISR events, auth, registration, badges, profile, schedule, feed, messages |
| Mobile (Flutter) | ~35% | Wave 1 basics done; full app deferred to Wave 9 after web validation |
| Shared UI | ~70% | Button, Card, Input, Badge, Spinner + utility functions (cn, format) |
| Infrastructure | 100% | Firestore rules, indexes, Firebase multi-site hosting, emulators, seed script |

### Sprint Breakdown (Wave 1 Completion)

| Sprint | Focus | Branch | Status |
|--------|-------|--------|--------|
| Sprint 0 | Git housekeeping | `main` established | `completed` |
| Sprint 1 | Web backoffice — event management | `feature/wave-1-web` | `completed` |
| Sprint 2 | Mobile — event discovery & registration | `feature/wave-1-mobile` | `completed` |
| Sprint 3 | Integration testing & Wave 1 close | `feature/wave-1-integration` | `completed` |

## Wave Progress

| Wave | Name | Platform | Status | File |
|------|------|----------|--------|------|
| Pre-Wave | Foundation Hardening | All | `completed` | [wave-0-prerequisites.md](wave-0-prerequisites.md) |
| Wave 1 | Core Loop — Create, Register, Badge | API + Web + Mobile | `completed` | [wave-1-core-loop.md](wave-1-core-loop.md) |
| Wave 2 | Check-in API & Web Dashboard | API + Web | `completed` | [wave-2-offline-checkin.md](wave-2-offline-checkin.md) |
| Wave 3 | Participant Web App | Web | `completed` | [wave-3-participant-web.md](wave-3-participant-web.md) |
| **Wave 4** | **Organizer Productivity** | **API + Web** | `completed` | [wave-4-organizer-tools.md](wave-4-organizer-tools.md) |
| **Wave 5** | **Feed, Messaging, Sessions** | **API + Web** | `completed` | [wave-5-social-sessions.md](wave-5-social-sessions.md) |
| Wave 6 | Payments | API + Web | `not_started` | [wave-6-payments.md](wave-6-payments.md) |
| Wave 7 | SMS, Email, Communication | API + Web | `not_started` | [wave-7-communications.md](wave-7-communications.md) |
| Wave 8 | Sponsor & Speaker Portals | API + Web | `not_started` | [wave-8-portals.md](wave-8-portals.md) |
| **Wave 9** | **Mobile App Completion** | **Mobile** | `not_started` | [wave-9-mobile-app.md](wave-9-mobile-app.md) |
| Wave 10 | Production Hardening & Launch | All | `not_started` | [wave-10-launch.md](wave-10-launch.md) |

**Status values:** `not_started` | `in_progress` | `completed` | `blocked`

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

## Architecture Reference

See [CLAUDE.md](../../CLAUDE.md) for full architecture documentation.

## Future Roadmap (Post-Wave 10)

See [future-roadmap.md](future-roadmap.md) for post-launch feature ideas.
