# ADR-0009: Store all timestamps as ISO 8601 strings, not Firestore `Timestamp`

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

Three clients consume Firestore documents:

- The Fastify API (Node.js, `firebase-admin` SDK)
- Web apps (browser, Firebase Web SDK)
- Mobile (Flutter, `cloud_firestore` plugin)

Each platform's native timestamp representation is different:

- **Admin SDK** → `Firestore.Timestamp { seconds, nanoseconds }`
- **Web SDK** → `firebase.firestore.Timestamp { seconds, nanoseconds }`
- **Flutter** → `Timestamp` from `cloud_firestore`, but `dart:core.DateTime` is more idiomatic
- **JSON over the wire** (REST responses, exports, audit logs) → string

A consistent representation across all four contexts has obvious value. Two options:

1. **Native `Timestamp`** — store `Timestamp` objects, let each SDK serialize/deserialize.
2. **ISO 8601 string** — store `new Date().toISOString()` always, parse on read where a `Date` is needed.

---

## Decision

**Every timestamp in Firestore is stored as an ISO 8601 string in UTC.**

```typescript
{
  createdAt: "2026-04-25T17:34:12.482Z",
  updatedAt: "2026-04-25T17:34:12.482Z",
  startDate: "2026-05-15T18:00:00.000Z",
  endDate: "2026-05-15T22:00:00.000Z",
  notBefore: "2026-05-15T16:00:00.000Z",  // QR validity window
  notAfter: "2026-05-16T04:00:00.000Z"
}
```

The Zod schemas in `@teranga/shared-types` use `z.string().datetime()` to validate the format on every write.

---

## Reasons

- **Cross-client consistency.** A `string` is a `string` everywhere. No SDK-specific deserialization.
- **JSON-native.** REST responses, audit logs, export CSVs, and webhook payloads need strings anyway. Storing strings means zero conversion at the API boundary.
- **Human readable.** Firestore console shows `"2026-04-25T17:34:12.482Z"` — instantly comprehensible without timezone math.
- **Zod-friendly.** `z.string().datetime()` validates on write; runtime guarantee that all timestamps are well-formed UTC.
- **Sortable lexicographically.** ISO 8601 in UTC sorts identically as strings and as dates. Firestore range queries (`where('createdAt', '>=', '2026-04-01T00:00:00Z')`) work directly.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Firestore `Timestamp` natively | Three SDKs, three deserialization paths, three sources of bugs around timezones and serialization. |
| Unix epoch ms (`number`) | Not human-readable in the console. Loses sub-millisecond precision for the QR `notBefore`/`notAfter` window (we use base36 epoch ms specifically for QR signature payload size — that's an internal optimization, not the canonical format). |
| Storing both ISO string and Timestamp | Doubles the write size and the source-of-truth confusion. |

---

## Consequences

**Positive**

- One representation, three clients, zero conversion.
- API responses pass timestamps through untouched.
- Audit logs are diff-friendly.
- Test fixtures use plain strings — no SDK setup needed.

**Negative**

- Cannot use Firestore's server-timestamp sentinel (`FieldValue.serverTimestamp()`). Mitigated by `new Date().toISOString()` on the API server, which has clock-sync via NTP on Cloud Run. Acceptable: the API is the only writer for most collections.
- Sub-millisecond precision is lost (only matters for high-frequency event ordering, which we don't have).
- Comparisons in code require `Date.parse()` or `new Date(s).getTime()` — minor ceremony.

**Follow-ups**

- Mobile app must format ISO strings via `DateTime.parse()` in Dart, then `intl` package for display in `fr_SN` / `wo_SN` locales. Pattern established in `apps/mobile/lib/core/datetime/iso_formatter.dart`.

---

## References

- `packages/shared-types/src/common.types.ts` — `IsoDateTimeSchema = z.string().datetime()`.
- `apps/api/src/services/qr-signing.ts` — uses base36 epoch ms internally for QR payload size, but converts back to ISO when surfacing notBefore/notAfter.
- CLAUDE.md → "Firestore" section: "Timestamps: Always ISO 8601 strings".
