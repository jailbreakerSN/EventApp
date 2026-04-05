# Teranga — Delivery Plan

## Overview

The Teranga platform delivery is organized into **8 waves**, each building on the previous one and producing a deployable increment. Every wave ends with a working, testable product that can be demonstrated to stakeholders.

**Total estimated timeline:** ~15 weeks (flexible, wave-by-wave)

## Current State (as of 2026-04-05)

| Component | Completion | Notes |
|-----------|-----------|-------|
| Shared Types | ~95% | Zod schemas, permissions, all core types |
| API (Fastify) | ~85% | Routes, services, repos, middleware, RBAC, transactions, audit, health |
| Cloud Functions | ~60% | Auth triggers, badge generation, notifications |
| Web Backoffice | ~30% | Layout shell, auth, basic event CRUD pages |
| Mobile (Flutter) | ~35% | Auth, home, event list, basic navigation |
| Infrastructure | 100% | Firestore rules, indexes, Firebase config |

## Wave Progress

| Wave | Name | Status | File |
|------|------|--------|------|
| Pre-Wave | Foundation Hardening | `completed` | [wave-0-prerequisites.md](wave-0-prerequisites.md) |
| Wave 1 | Core Loop — Create, Register, Badge | `not_started` | [wave-1-core-loop.md](wave-1-core-loop.md) |
| Wave 2 | Offline QR Scanning & Check-in | `not_started` | [wave-2-offline-checkin.md](wave-2-offline-checkin.md) |
| Wave 3 | Organizer Productivity | `not_started` | [wave-3-organizer-tools.md](wave-3-organizer-tools.md) |
| Wave 4 | Feed, Messaging, Sessions | `not_started` | [wave-4-social-sessions.md](wave-4-social-sessions.md) |
| Wave 5 | Payments | `not_started` | [wave-5-payments.md](wave-5-payments.md) |
| Wave 6 | SMS, Email, Communication | `not_started` | [wave-6-communications.md](wave-6-communications.md) |
| Wave 7 | Sponsor & Speaker Portals | `not_started` | [wave-7-portals.md](wave-7-portals.md) |
| Wave 8 | Production Hardening & Launch | `not_started` | [wave-8-launch.md](wave-8-launch.md) |

**Status values:** `not_started` | `in_progress` | `completed` | `blocked`

## Delivery Principles

1. **Each wave is independently deployable** — stakeholders can test after every wave
2. **API-first** — backend endpoints land before frontend consumes them
3. **Shared types are the contract** — Zod schemas updated first, then API + clients
4. **Offline-first for mobile** — every mobile feature must work with intermittent connectivity
5. **Tests accompany every feature** — unit tests for services, integration tests for routes
6. **Security at every layer** — Firestore rules, API middleware, input validation
7. **Francophone-first** — French is the default language for all user-facing strings

## Architecture Reference

See [CLAUDE.md](../../CLAUDE.md) for full architecture documentation.

## Future Roadmap (Post-Wave 8)

See [future-roadmap.md](future-roadmap.md) for post-launch feature ideas.
