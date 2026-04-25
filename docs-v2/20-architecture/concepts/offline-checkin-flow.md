---
title: Offline check-in flow
status: shipped
last_updated: 2026-04-25
---

# Offline check-in flow

The platform's **core differentiator**: reliable QR badge scanning at events held in venues with intermittent connectivity. Below is the sequence from "staff opens the scanner" to "check-in syncs back when connectivity returns."

> Today the offline scanner ships in the **mobile** app (Wave 9 — currently planned). The web backoffice has an online-only check-in dashboard and a manual fallback. The flow below describes the mobile path.

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor Staff
    participant App as Mobile App<br/>Flutter
    participant Hive as Hive (local)
    participant API as Fastify API
    participant FS as Firestore
    participant Bus as Domain<br/>Event Bus
    participant Audit as auditLogs<br/>listener

    Note over Staff,App: Pre-event sync (online required)
    Staff->>App: Open event check-in
    App->>API: GET /v1/checkin/sync?eventId=<id>
    API->>FS: read registrations + qrSecretDerived
    API-->>App: { registrations, qrKey, syncCursor }
    App->>Hive: cache registrations + key + cursor

    Note over Staff,App: Doors open — connectivity may drop
    Staff->>App: Scan QR
    App->>App: parse QR (registrationId:eventId:userId:nb:na:sig)
    App->>App: verify HMAC locally<br/>(timingSafeEqual)
    App->>App: check notBefore..notAfter window
    App->>Hive: lookup registration by id

    alt Valid + not yet checked in
        App->>Hive: append { regId, scannedAt, op: checkin } to queue
        App-->>Staff: ✓ Vert — bienvenue Moussa Diop
    else Already checked in
        App-->>Staff: ⚠️ Déjà scanné à 14h32
    else QR invalid / expired / unknown
        App-->>Staff: ✗ Rouge — badge invalide
    end

    Note over App,FS: Connectivity returns
    App->>App: detect connectivity (connectivity_plus)
    App->>API: POST /v1/checkin/sync<br/>{ events: [...queue] }
    API->>API: validate signatures (server-side replay)

    loop For each queued event
        rect rgb(245, 245, 245)
        Note over API,FS: Atomic transaction
        API->>FS: read registration + checkin doc
        alt Not yet checked in
            API->>FS: write checkin + update registration
            API->>Bus: emit registration.checked_in
            Bus->>Audit: append auditLogs entry
        else Already exists (concurrent scan)
            API->>API: idempotent merge — no-op
        end
        end
    end

    API-->>App: { synced: N, conflicts: [], serverCursor }
    App->>Hive: clear synced ops + advance cursor
    App-->>Staff: 12 scans synchronisés
```

## Key invariants

| Invariant | Where enforced |
|---|---|
| QR is unforgeable offline | HMAC-SHA256 with derived per-event key cached in Hive at sync time. Local `timingSafeEqual` verify ([ADR-0003](../decisions/0003-qr-v4-hkdf-design.md)) |
| Scan window respected | `notBefore..notAfter` baked into the QR payload (v3+); v2/v1 fall back to `event.startDate − 24h .. event.endDate + 6h` |
| Offline check-ins are idempotent | Each queued op carries `(registrationId, scannedAt)`; server-side merge dedupes on `registrationId` |
| Concurrent scans (two devices) resolve deterministically | Last-write-wins on `checkinAt`; both devices see the canonical `checkedInAt` post-sync |
| No drop on first sync | Hive queue persists across app restarts; cursor only advances after server ACK |
| Audit log has an entry per check-in | Domain event bus fires `registration.checked_in` after the transaction commits ([ADR-0010](../decisions/0010-domain-event-bus.md)) |

## Failure modes

| Scenario | Behavior |
|---|---|
| Staff goes offline before initial sync | App refuses to enter check-in mode (no cached registrations to validate against). Visible warning: "Vous devez synchroniser au moins une fois". |
| Battery dies, app restarts | Hive queue persists; cursor unchanged; resync on next open |
| Conflicting check-ins from web admin (manual) + mobile scan | Server-side transaction wins; mobile sees the conflict in `conflicts[]` and surfaces it as a warning |
| Sync bandwidth poor | Sync chunked into batches of 50 ops; partial progress is durable |
| QR encrypted v4 in a future version | Fallback path: app can still verify but the rotation cadence applies — see [ADR-0004 ECDH X25519](../decisions/0004-offline-sync-ecdh-encryption.md) |

## Storage budget on the device

For a 5,000-attendee event:

- ~600 KB Hive cache for registrations (id, name, photo URL, status).
- ~32 bytes per queued op × 5,000 max scans ≈ 160 KB.
- **Total: under 1 MB.** Acceptable on entry-level Android devices.

## Related references

- [`docs-v2/30-api/checkins.md`](../../30-api/checkins.md)
- [`docs-v2/40-clients/mobile-flutter.md`](../../40-clients/mobile-flutter.md)
- [ADR-0003 QR v4 HKDF](../decisions/0003-qr-v4-hkdf-design.md)
- [ADR-0004 Offline sync ECDH X25519](../decisions/0004-offline-sync-ecdh-encryption.md)
- CLAUDE.md → "QR Badge Security"
