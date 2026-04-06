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
- [ ] Verify `checkIn()` transactional flow works end-to-end
- [ ] Offline sync data endpoint: GET `/v1/events/:id/sync` (returns registrations for offline cache)
- [ ] Bulk check-in sync endpoint: POST `/v1/events/:id/checkin/sync` (accepts array of offline check-ins)
- [ ] Check-in statistics endpoint: GET `/v1/events/:id/checkin/stats`
- [ ] Conflict resolution for offline check-ins (timestamp-based, last-write-wins with audit)

#### Access Zones
- [ ] Access zone management endpoints (CRUD within event)
- [ ] Zone-specific check-in validation
- [ ] Zone capacity tracking

### Mobile (Flutter) — Staff Scanner

- [ ] QR scanner screen using device camera (`mobile_scanner` package)
- [ ] Offline registration cache using Hive
  - [ ] Pre-event sync: download all registrations for assigned event
  - [ ] Store QR → registration mapping locally
  - [ ] Periodic background sync when online
- [ ] Offline check-in queue
  - [ ] Scan → validate against local cache → mark checked-in locally
  - [ ] Queue check-in records in Hive when offline
  - [ ] Auto-sync queue when connectivity returns
  - [ ] Visual indicator: online/offline status, pending sync count
- [ ] Check-in result screen (participant name, ticket type, access zone, photo if available)
- [ ] Duplicate scan detection (show "already checked in" with timestamp)
- [ ] Manual check-in search (find by name/email when QR fails)
- [ ] Check-in statistics dashboard (scanned/total, by zone)

### Cloud Functions

- [ ] `onCheckinCompleted` trigger → update real-time dashboard counters
- [ ] Conflict resolution function for simultaneous online/offline check-ins

### Web Backoffice

- [ ] Live check-in dashboard (real-time counter, recent check-ins feed)
- [ ] Check-in history table with search
- [ ] Access zone management UI

### Shared Types

- [ ] Offline sync data schema
- [ ] Bulk check-in sync request/response schemas
- [ ] Check-in statistics schema
- [ ] Access zone CRUD schemas

---

## Exit Criteria

- [ ] Staff can scan QR codes and check in participants while online
- [ ] Staff can pre-sync event data and scan QR codes while completely offline
- [ ] Offline check-ins sync automatically when connectivity returns
- [ ] Duplicate scans are caught both online and offline
- [ ] Access zones restrict entry correctly
- [ ] Real-time check-in dashboard works in web backoffice
- [ ] End-to-end test: go offline → scan 10 badges → come online → verify all synced

## Dependencies

- Wave 1 completed (badges exist, registrations exist)
- QR signing/verification working (already implemented)
- Mobile scanner package integrated

## Deploys After This Wave

- API: Sync + bulk check-in + stats endpoints
- Mobile: Full scanner with offline capability
- Web: Live check-in dashboard
- Functions: Check-in counter triggers

## Technical Notes

- **Hive** is the offline storage for Flutter (not SQLite) — already in the stack
- **Sync strategy**: Full sync before event, delta sync during event (only changed registrations)
- **Conflict resolution**: Server timestamp wins. If offline check-in arrives after an online cancel, the cancel takes precedence (status check in bulk sync endpoint)
- **Battery/performance**: Scanner screen should minimize background work, keep camera active efficiently
