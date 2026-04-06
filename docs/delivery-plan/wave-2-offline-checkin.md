# Wave 2: Offline QR Scanning & Check-in

**Status:** `in_progress`
**Estimated effort:** 1.5 weeks
**Goal:** Staff can scan QR badges at event entrances, even with no internet connection.

## Why This Wave Matters

This is Teranga's **core differentiator**. African events often have unreliable connectivity. The check-in system MUST work offline and sync when connectivity returns. This is the feature that sets Teranga apart.

---

## Tasks

### API (Fastify)

#### Check-in Endpoints
- [x] Verify `checkIn()` transactional flow works end-to-end
- [x] Offline sync data endpoint: GET `/v1/events/:id/sync` (returns registrations for offline cache)
- [x] Bulk check-in sync endpoint: POST `/v1/events/:id/checkin/sync` (accepts array of offline check-ins)
- [x] Check-in statistics endpoint: GET `/v1/events/:id/checkin/stats`
- [x] Check-in history endpoint: GET `/v1/events/:id/checkin/history` (paginated, searchable)
- [x] Conflict resolution for offline check-ins (timestamp-based, last-write-wins with audit)

#### Access Zones
- [x] Access zone management endpoints (CRUD within event)
- [x] Zone-specific check-in validation
- [x] Zone capacity tracking (atomic counters with `zoneCheckedInCounts`)

### Mobile (Flutter) — DEFERRED TO WAVE 9

> **All mobile scanner tasks have been deferred to Wave 9 (Mobile App Completion).**
> The MVP prioritizes web-first delivery. The offline QR scanner is the core mobile differentiator and will be built when the web platform is stable.
>
> Deferred tasks: QR camera scanner, Hive offline cache, offline check-in queue, auto-sync, duplicate detection, manual search, mobile stats dashboard.

### Cloud Functions

- [x] `onCheckinCompleted` trigger → write check-in feed entry for real-time dashboard
- [ ] Conflict resolution function for simultaneous online/offline check-ins

### Web Backoffice

- [x] Live check-in dashboard (stat cards, progress bar, zone capacity, ticket breakdown, recent feed)
- [x] Check-in history table with search and zone filter
- [x] Access zone management UI (add/remove zones with color picker and capacity)
- [x] Check-in button on published event detail page

### Shared Types

- [x] Offline sync data schema
- [x] Bulk check-in sync request/response schemas
- [x] Check-in statistics schema
- [x] Access zone CRUD schemas
- [x] Check-in history query/response schemas
- [x] Zone capacity status (`zone_full`)

---

## Exit Criteria

- [x] Check-in API endpoints work end-to-end (online check-in via API)
- [x] Offline sync data endpoint returns correct registration payload
- [x] Bulk check-in sync processes offline check-ins with conflict resolution
- [x] Access zones restrict entry correctly (zone capacity enforcement)
- [x] Real-time check-in dashboard works in web backoffice
- [x] Check-in statistics endpoint returns accurate data
- [ ] ~~Mobile offline scanner~~ → Deferred to Wave 9

## Dependencies

- Wave 1 completed (badges exist, registrations exist)
- QR signing/verification working (already implemented)
- Mobile scanner package integrated (deferred to Wave 9)

## Deploys After This Wave

- API: Sync + bulk check-in + stats endpoints
- Web: Live check-in dashboard
- Mobile: Deferred to Wave 9
- Functions: Check-in counter triggers

## Technical Notes

- **Hive** is the offline storage for Flutter (not SQLite) — already in the stack
- **Sync strategy**: Full sync before event, delta sync during event (only changed registrations)
- **Conflict resolution**: Server timestamp wins. If offline check-in arrives after an online cancel, the cancel takes precedence (status check in bulk sync endpoint)
- **Battery/performance**: Scanner screen should minimize background work, keep camera active efficiently
