# ADR-0008: Soft-delete only (no hard deletes anywhere)

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

The platform handles event registrations, badges, financial transactions, audit logs, and personal data covered by Senegal's loi 2008-12 sur la protection des données and (for European participants) the GDPR. Each of those records has at least one of three properties that make a hard delete dangerous:

1. **Audit trail dependency** — auditLogs reference registration IDs, event IDs, organization IDs. A hard-deleted event would orphan months of audit history.
2. **Financial integrity** — receipts, payouts, and balanceTransactions are immutable accounting records. Tax law requires retention regardless of user action.
3. **Operational recoverability** — an organizer who "deletes" a published event 6 hours before doors open must be recoverable. Likewise for a participant who cancels then changes their mind.

Three options existed:

1. **Hard delete** — `db.collection(...).doc(...).delete()`. Simple, but irreversible and breaks audit/finance.
2. **Tombstone collection** — move the document to `deleted/{originalCollection}/{originalId}`. Preserves the data but doubles the rule surface, breaks queries by ID, and complicates restore.
3. **Soft delete via status** — set `status: "archived" | "cancelled" | "deleted"` on the original document, filter on read.

---

## Decision

**No service ever hard-deletes a Firestore document. All "delete" operations set a status field.**

The convention is collection-specific:

| Collection | Soft-delete state | Filtered out of |
|---|---|---|
| `events` | `status: "archived"` or `status: "cancelled"` | Public listings, organizer dashboards by default |
| `registrations` | `status: "cancelled"` | Active participant counts, badge generation |
| `badges` | `status: "revoked"` | Scan validation |
| `notifications` | `status: "archived"` | User inbox |
| `messages` | `status: "deleted"` | Thread view |
| `users` | `status: "deactivated"` | Auth login (separately disabled in Firebase Auth) |
| `organizations` | `status: "archived"` | Organizer signup, member invites |
| `apiKeys` | `revokedAt: ISOString` | Auth verification |

Firestore rules enforce this: `allow delete: if false;` on every collection that holds personal or financial data.

---

## Reasons

- **Auditability is non-negotiable.** Every state transition emits a domain event consumed by the `auditLogs` collection. Hard delete breaks the foreign key.
- **Recovery is operationally cheap.** A super-admin can flip `status` back to `active` in a single Firestore write. Tombstones would require a multi-step restore.
- **Query patterns stay simple.** Services filter `.where('status', '!=', 'archived')` — no second collection to maintain.
- **GDPR right-to-erasure is handled separately** via a deletion job that scrubs PII from the document while keeping the structural row (`anonymizedAt: ISOString`, `email: null`, `displayName: "[deleted user]"`). The deletion job is the only writer permitted to mutate `anonymizedAt` — covered by ADR-0011 RBAC and a dedicated `super_admin:delete_pii` permission.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Hard delete + audit log retention | Audit logs reference IDs; orphaned IDs make audit log unverifiable. |
| Tombstone collection | Doubles rule surface, fragments queries, no operational benefit over a status flag. |
| TTL-based deletion (Firestore TTL policy) | Cannot be conditional on business state. Too coarse for our retention requirements. |

---

## Consequences

**Positive**

- Audit trail is unbreakable.
- Recovery is a one-line write.
- Financial records are tamper-evident by construction.
- Test fixtures can include "cancelled" / "archived" states without special seed branches.

**Negative**

- Storage cost grows monotonically. Mitigated by archival job that moves status:archived events older than 18 months to cold storage (Cloud Storage JSON dump) — planned, not yet shipped.
- Every read path must remember to filter by status. Mitigation: `BaseRepository.softDelete(id, statusField, statusValue)` keeps every soft-delete consistent on the write side; `BaseRepository.findActive(filters, pagination, opts)` excludes the tombstone statuses (`archived` + `cancelled` by default, configurable per call) so list endpoints don't accidentally surface deleted records.
- Firestore composite indexes need a `status` field on most collections.

**Follow-ups**

- Cold storage archival job (planned, ADR to follow when shipped).
- GDPR PII-scrub job (planned, ties into `super_admin:delete_pii`).

---

## References

- `apps/api/src/services/event.service.ts` — `archive()`, `cancel()` methods.
- `apps/api/src/repositories/base.repository.ts` — `softDelete(id, statusField, statusValue)` (write side) and `findActive(filters, pagination, opts)` (read side, excludes `archived` + `cancelled` by default).
- `infrastructure/firebase/firestore.rules` — `allow delete: if false;` patterns.
