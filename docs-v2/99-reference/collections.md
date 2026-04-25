---
title: Firestore Collections Reference
status: shipped
last_updated: 2026-04-25
---

# Firestore Collections Reference

> Quick-lookup index of every Firestore collection in the platform. Collection name constants are defined in `apps/api/src/config/firebase.ts` (API) and `apps/functions/src/utils/admin.ts` (Cloud Functions). Always use the `COLLECTIONS` constant — never hardcode string names.

---

## Usage

```typescript
import { COLLECTIONS } from '@/config/firebase';

// Correct
const ref = db.collection(COLLECTIONS.REGISTRATIONS);

// Wrong — never hardcode
const ref = db.collection('registrations');
```

---

## Full Collection Index

| Constant | Collection Name | Description |
|---|---|---|
| `COLLECTIONS.USERS` | `users` | Firebase Auth-linked user profiles with roles and preferences |
| `COLLECTIONS.ORGANIZATIONS` | `organizations` | Multi-tenant root: plan, effectiveLimits, memberIds, Stripe/payment metadata |
| `COLLECTIONS.EVENTS` | `events` | Event documents: embedded TicketTypes, AccessZones, scan policy, QR key metadata |
| `COLLECTIONS.SESSIONS` | `sessions` | Conference sessions within an event (speaker links, track, room, schedule) |
| `COLLECTIONS.REGISTRATIONS` | `registrations` | Participant registrations: status, ticketType, payment state, custom field responses |
| `COLLECTIONS.BADGES` | `badges` | Generated QR badge documents: signed QR payload, validity window, version |
| `COLLECTIONS.BADGE_TEMPLATES` | `badgeTemplates` | Per-org badge layout templates (canvas elements, font choices, logo placement) |
| `COLLECTIONS.CHECKINS` | `checkins` | Individual check-in scan events: timestamp, actor, method (qr/manual), zone |
| `COLLECTIONS.CHECKIN_FEED` | `checkinFeed` | Real-time feed of check-in events for the live dashboard |
| `COLLECTIONS.CHECKIN_LOCKS` | `checkinLocks` | Short-lived Firestore transaction locks preventing double-scan race conditions |
| `COLLECTIONS.OFFLINE_SYNC` | `offlineSync` | ECDH-encrypted registration snapshots downloaded by staff scanner apps |
| `COLLECTIONS.CONVERSATIONS` | `conversations` | Messaging thread metadata: participants, lastMessage, unreadCounts |
| `COLLECTIONS.MESSAGES` | `messages` | Individual messages within a conversation |
| `COLLECTIONS.FEED_POSTS` | `feedPosts` | Event social feed posts: author, content, media, reaction counts |
| `COLLECTIONS.FEED_COMMENTS` | `feedComments` | Comments on feed posts |
| `COLLECTIONS.NOTIFICATIONS` | `notifications` | Per-user push/in-app notification documents |
| `COLLECTIONS.NOTIFICATION_PREFERENCES` | `notificationPreferences` | Per-user notification channel opt-in/opt-out settings |
| `COLLECTIONS.BROADCASTS` | `broadcasts` | Organizer broadcast campaigns: target (all/segment), channel, delivery status |
| `COLLECTIONS.PAYMENTS` | `payments` | Payment transactions: provider, amount (XOF), status, webhook reference |
| `COLLECTIONS.RECEIPTS` | `receipts` | Payment receipts issued to participants |
| `COLLECTIONS.PAYOUTS` | `payouts` | Organizer payout records: amount, status, provider reference, release date |
| `COLLECTIONS.BALANCE_TRANSACTIONS` | `balanceTransactions` | Ledger entries for organizer balance (credits and debits) |
| `COLLECTIONS.REFUND_LOCKS` | `refundLocks` | Short-lived locks preventing duplicate refund processing |
| `COLLECTIONS.INVITES` | `invites` | Pending org/event member invitations (token-based) |
| `COLLECTIONS.SPEAKERS` | `speakers` | Speaker profiles linked to events and sessions |
| `COLLECTIONS.SPONSORS` | `sponsors` | Sponsor records per event: tier, booth, logo, lead-capture config |
| `COLLECTIONS.SPONSOR_LEADS` | `sponsorLeads` | Lead capture records: participant contact, sponsor, timestamp, interest |
| `COLLECTIONS.PROMO_CODES` | `promoCodes` | Discount codes: percentage/fixed, usage limits, expiry, eligibility |
| `COLLECTIONS.VENUES` | `venues` | Venue profiles: address, capacity, amenities, contact |
| `COLLECTIONS.SUBSCRIPTIONS` | `subscriptions` | Active org subscription: plan, status, billing period, scheduledChange |
| `COLLECTIONS.PLANS` | `plans` | Dynamic plan catalog documents (Phase 5+ migration from hardcoded PLAN_LIMITS) |
| `COLLECTIONS.AUDIT_LOGS` | `auditLogs` | Immutable audit trail: action, actorId, resourceType, resourceId, requestId |
| `COLLECTIONS.SMS_LOG` | `smsLog` | Outbound SMS records via Africa's Talking |
| `COLLECTIONS.EMAIL_LOG` | `emailLog` | Outbound email records via Resend |
| `COLLECTIONS.NEWSLETTER_SUBSCRIBERS` | `newsletterSubscribers` | Email newsletter opt-ins |
| `COLLECTIONS.SESSION_BOOKMARKS` | `sessionBookmarks` | Participant session bookmarks for conference agenda building |
| `COLLECTIONS.COUNTERS` | `counters` | Atomic counter documents for registration counts (avoids read-then-write) |

---

## Collections by Domain

### Core Event Flow
`organizations` → `events` → `registrations` → `badges` → `checkins`

### Payments
`payments` → `receipts` → `balance_transactions` → `payouts`

### Communications
`notifications` ← `notificationPreferences`  
`broadcasts` (organizer push/email campaigns)  
`conversations` → `messages`  
`smsLog`, `emailLog` (delivery audit)

### Social
`feedPosts` → `feedComments`  
`sessionBookmarks`

### Access Control
`invites` (pending member invitations)  
`organizations.memberIds[]` (active members)

### Operations
`auditLogs` (immutable, write-once)  
`checkinLocks`, `refundLocks` (TTL-based mutex documents)  
`offlineSync` (encrypted snapshots for staff apps)

### Platform Configuration
`plans` (dynamic plan catalog, Phase 5+)  
`subscriptions` (per-org subscription state)  
`promoCodes`

---

## Immutability and Security Rules

The following fields are protected by Firestore security rules and must not be changed after document creation:

| Collection | Immutable Fields |
|---|---|
| `events` | `organizationId`, `createdBy` |
| `registrations` | `organizationId`, `eventId`, `userId`, `createdBy` |
| `badges` | `registrationId`, `eventId`, `userId` |
| `checkins` | `registrationId`, `eventId`, `userId`, `timestamp` |
| `auditLogs` | all fields (write-once) |
| `payments` | `organizationId`, `eventId`, `userId`, `amount`, `currency` |

---

## Hard-Delete Policy

**No collection supports hard delete.** All deletions are soft:

- Events, registrations: `status: "cancelled"` or `"archived"`
- Users: pseudonymization (GDPR deletion) — personal fields replaced with `[deleted]`
- Payments, audit logs: never deleted, no status change

```javascript
// Firestore rules — applies to all sensitive collections
allow delete: if false;
```

---

## Collections Excluded from Client-Side Rules

These collections are **Admin SDK only** — no client can write to them:

- `badges` (`allow create: if false` — only Cloud Functions)
- `notifications` (`allow create: if false` — only Cloud Functions)
- `auditLogs` (write-once via Admin SDK)
- `checkinLocks`, `refundLocks` (internal mutex documents)

---

## Functions vs. API COLLECTIONS Sync

Both `apps/api/src/config/firebase.ts` and `apps/functions/src/utils/admin.ts` define a `COLLECTIONS` object. They must stay in sync. When adding a new collection:

1. Add to `apps/api/src/config/firebase.ts`
2. Add to `apps/functions/src/utils/admin.ts` if any Cloud Function trigger reads/writes it
3. Add to `infrastructure/firebase/firestore.rules` with appropriate rules
4. Add to this reference document
