# Notification System — Architecture Design

**Status:** proposal · 2026-04-21
**Owner:** API + Platform team
**Context:** Follow-up to the notification audit of 2026-04-21 (see
`./notification-audit-2026-04-21.md`). Ten transactional emails ship today,
each implemented as a hand-written `emailService.sendXxx()` helper. This
document is the technical design for a declarative catalog + settings plane

- runtime dispatcher that future-proofs the platform for SMS, push, and
  in-app inbox without re-architecting.

---

## 1. Context & goals

**What's broken today.** Every notification is a bespoke method on
`EmailService` (`apps/api/src/services/email.service.ts:402-516`) with its
template, subject line, recipient resolution, and locale logic inlined.
There is no central registry of which notifications exist, so there is
nowhere to hang a super-admin kill-switch, a per-key user opt-out, or a
channel selector. The only user preference we honour is a single
`notificationPreferences.email` boolean — granular control ("I want
registration confirmations but not marketing") is impossible without
re-plumbing every call site. The system is email-only by construction:
SMS, push, and in-app would each require parallel services.

**What we want.** A declarative `NotificationCatalog` in
`packages/shared-types` that enumerates every notification key, the
channels it supports, who receives it, and whether users may opt out.
Admin overrides live in a Firestore `notificationSettings` collection and
are editable by super-admins through the backoffice. At runtime, a single
`NotificationService.dispatch()` entry point resolves catalog +
admin-override + user-preferences + suppression list, fans out to the
allowed channel adapters, and emits audit events. Email is v1; SMS/push/
in-app ship as additional `ChannelAdapter` implementations with no
dispatcher changes.

---

## 2. Non-goals for v1

- SMS dispatch — Africa's Talking adapter is a schema hook only.
- Push dispatch — FCM adapter is a schema hook only.
- In-app inbox UI — `users/{uid}/inbox` subcollection is a schema hook only.
- Per-channel template variants (one template id per channel is enough).
- A/B testing of subject lines or bodies.
- Per-organization localization override (we resolve recipient locale only).
- Digest/batching (one `dispatch()` call = one delivery per channel).

All of the above are reserved in the types and dispatcher contract but
ship as no-op adapters or rejected with `UNSUPPORTED_CHANNEL` in v1.

---

## 3. High-level architecture

```
[Domain event]
    │
    ▼
[Listener in apps/api/src/events/listeners/*]
    │  (calls)
    ▼
[NotificationService.dispatch({key, recipients, params})]
    │
    ├──► [NotificationCatalog] (packages/shared-types)
    │       └─ definition lookup
    ├──► [NotificationSettingsRepository]
    │       └─ admin override (enabled/channels/subject)
    ├──► [UserPreferencesRepository]
    │       └─ per-key opt-out check
    ├──► [SuppressionListRepository]
    │       └─ bounce / RFC-8058 unsubscribe check
    │
    ▼  (for each allowed channel)
[ChannelAdapter: email | sms (stub) | push (stub) | in_app (stub)]
    │
    ▼
[Resend / Africa's Talking / FCM / Firestore]
```

The dispatcher is the only code path that knows how to combine catalog
metadata, admin overrides, and user preferences. Listeners never read
`notificationSettings` or `users/{uid}.notificationPreferences` directly.
Channel adapters never read admin overrides — they receive a fully-resolved
`(definition, recipient, params)` tuple and their job is to render and send.

---

## 4. Core types

Lives in `packages/shared-types/src/notification-catalog.ts`:

```ts
export type NotificationChannel = "email" | "sms" | "push" | "in_app";
export type NotificationCategory =
  | "auth"
  | "transactional"
  | "organizational"
  | "billing"
  | "marketing";

export interface I18nString {
  fr: string;
  en: string;
  wo: string;
}

export interface NotificationDefinition {
  /** Stable key, e.g. "registration.created". Never change once live. */
  key: string;
  /** User-preference bucket + security/transactional classification. */
  category: NotificationCategory;
  displayName: I18nString;
  description: I18nString;
  /** Channels the template/code path supports. */
  supportedChannels: NotificationChannel[];
  /** Default channels emitted when admin hasn't overridden. */
  defaultChannels: NotificationChannel[];
  /** If false, users cannot opt out (security / transactional). */
  userOptOutAllowed: boolean;
  /** Template id per channel. Resolved by ChannelAdapter. */
  templates: Partial<Record<NotificationChannel, string>>;
  /** Driving domain event (see apps/api/src/events/domain-events.ts). */
  triggerDomainEvent: string;
  /** Who receives the notification. */
  recipientResolver: "self" | "org-owners" | "org-billing" | "event-organizer" | "custom";
  scope: "platform" | "organization" | "event";
}

export interface NotificationSetting {
  key: string;
  enabled: boolean;
  channels: NotificationChannel[];
  subjectOverride?: I18nString;
  updatedAt: string;
  updatedBy: string;
}

export interface NotificationRecipient {
  userId?: string;
  email?: string;
  phone?: string;
  fcmTokens?: string[];
  preferredLocale: "fr" | "en" | "wo";
}

export interface DispatchRequest<P = Record<string, unknown>> {
  key: string;
  recipients: NotificationRecipient[];
  params: P;
  idempotencyKey?: string;
  channelOverride?: NotificationChannel[];
}
```

The catalog itself is a `const NOTIFICATION_CATALOG: Record<string,
NotificationDefinition>` exported from the same file. Adding a new
notification means adding one entry to the record — no runtime
registration API. This keeps the TypeScript compiler honest about
template ids and categories.

---

## 5. Firestore collections

| Collection                       | Purpose                                                                                      | Access                               |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| `notificationSettings/{key}`     | One doc per catalog key. Schema = `NotificationSetting`. Missing doc = use catalog defaults. | Server-only (super-admin API writes) |
| `notificationDispatchLog/{id}`   | Append-only send log (v2 — for the admin detail drawer). TTL 30 days.                        | Server-only                          |
| `emailSuppressions/{emailLower}` | Existing bounce / RFC-8058 unsubscribe list. **No change.**                                  | Server-only                          |

Firestore rules additions for `infrastructure/firebase/firestore.rules`:

```
match /notificationSettings/{key} {
  allow read, write: if false;
}

match /notificationDispatchLog/{id} {
  allow read, write: if false;
}
```

Everything is written via Admin SDK from the API. The super-admin
backoffice reads through `GET /v1/admin/notifications` — not direct
Firestore — so client SDKs never touch these collections.

---

## 6. Why the catalog lives in `shared-types`

Two callers need the full catalog:

1. **API runtime** — `NotificationService.dispatch()` looks up the
   definition by key on every call.
2. **Super-admin UI (`apps/web-backoffice`)** — the `/admin/notifications`
   route renders one row per catalog entry, including entries that have
   never been overridden (i.e. not yet in `notificationSettings`).

Putting the catalog in `packages/shared-types/src/notification-catalog.ts`
keeps it the single source of truth and importable by both Node (API) and
browser (Next.js) without duplicating the data. After any edit, run:

```bash
npm run types:build
```

so the compiled output is picked up by downstream packages. CI fails the
build if `shared-types` is edited without a rebuild committed.

---

## 7. Dispatcher algorithm (`NotificationService.dispatch`)

1. Look up `NotificationDefinition` by `key` in `NOTIFICATION_CATALOG`.
   Throw `NotFoundError("unknown notification key: …")` if absent — this
   is a programming error, not a user-facing condition.
2. Load the admin override from `notificationSettings/{key}`. If
   `override.enabled === false` → emit `notification.suppressed`
   (reason: `admin_disabled`) and return immediately. No per-recipient
   loop.
3. Compute `effectiveChannels =
channelOverride ?? override.channels ?? definition.defaultChannels`.
   Intersect with `definition.supportedChannels` to drop any channel the
   template doesn't implement.
4. For each recipient in `recipients`:
   1. If `definition.userOptOutAllowed` and the user opted out —
      `users/{uid}.notificationPreferences.byKey[key] === false` — emit
      `notification.suppressed` (reason: `user_opted_out`) and skip.
   2. If `recipient.email` is present and lower-cased exists in
      `emailSuppressions` → skip and emit
      `notification.suppressed` (reason: `on_suppression_list`). For
      non-email channels, this step is skipped.
   3. Resolve locale (see §9) and substitute into subject/body.
   4. For each channel in `effectiveChannels`, call
      `ChannelAdapter[channel].send(definition, recipient, params)`.
      Errors from one channel do not abort other channels for the same
      recipient.
   5. On success → emit `notification.sent` once per channel.
5. All `eventBus.emit(...)` calls are fire-and-forget (never `await`). The
   dispatcher returns after the last channel adapter resolves; audit
   writes happen on the next tick.

---

## 8. Security & transactional classes ignore user opt-out

Notifications with `userOptOutAllowed = false` bypass the per-key user
preference check entirely. This applies to:

- `auth.*` — email verification, password reset, MFA enrollment.
- `payment.failed`, `refund.completed`, `refund.failed`.
- `password.changed`, `email.changed`.

**Rationale.** A user who silently stops receiving
`payment.failed` notifications cannot tell why their subscription was
downgraded. A user who opts out of `email.changed` has no signal when
an attacker swaps their recovery address. These notifications are part
of the account-security contract, not a preference. The super-admin
kill-switch (§7 step 2) still applies — a platform outage affecting the
email provider can globally disable all categories — but individual
users cannot.

The marketing categories (`marketing`, and most of `organizational`) have
`userOptOutAllowed = true` and the user-preferences UI offers per-key
toggles plus a "pause all marketing" master switch.

---

## 9. Locale resolution chain

Resolved by the dispatcher before the channel adapter is called, in this
order (first non-null wins):

```
recipient.preferredLocale
  → users/{uid}.locale
  → organizations/{orgId}.defaultLocale
  → "fr"   // platform default
```

The resolved locale is passed to the channel adapter as part of
`NotificationRecipient`. Templates select the matching branch of the
`I18nString` (fr/en/wo) for subject, body, and CTA labels. If a
translation is missing, the adapter falls back to `fr` and emits a
`notification.translation_missing` warning log (not an audit event —
this is an ops signal, not a security event).

---

## 10. Idempotency

The existing Resend integration already supports idempotency keys via
`apps/api/src/services/email/sender.registry.ts`. The dispatcher composes
the downstream key as:

```
idempotencyKey = sha256(`${key}:${recipient.userId ?? recipient.email}:${providedKey}`)
```

and dedup is honoured by Resend for 24h. If the caller did not supply
`idempotencyKey`, the dispatcher auto-generates one from
`${key}:${recipient.userId}:${params.id}` — enough for most
domain-event-driven paths where `params.id` is the registration or event id.

**Listener guidance.** Listeners should pass a stable `idempotencyKey`
whenever the domain event can replay (Firestore trigger retries, manual
resync, emulator replay). Example for the registration listener:

```ts
await notificationService.dispatch({
  key: "registration.created",
  recipients: [...],
  params: { registration },
  idempotencyKey: `${registration.eventId}:${registration.userId}:registration.created`,
});
```

---

## 11. New audit actions

Add to `packages/shared-types/src/audit.types.ts`:

| Action                         | Actor           | Target (notification key)   | Meta                                                                                                  |
| ------------------------------ | --------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `notification.sent`            | `"system"`      | e.g. `registration.created` | `{ recipient, channel, messageId }`                                                                   |
| `notification.suppressed`      | `"system"`      | e.g. `registration.created` | `{ recipient, reason }` where reason ∈ {admin_disabled, user_opted_out, on_suppression_list, bounced} |
| `notification.setting_updated` | super-admin uid | e.g. `registration.created` | `{ enabled, channels, subjectOverride }`                                                              |

Written by the existing `audit.listener.ts` — it already subscribes to
domain events and maps them to the `auditLogs` collection. The only work
is extending the mapping table; no new listener plumbing.

---

## 12. Super-admin UI (v1 = Phase 4)

Route: `/admin/notifications` on `apps/web-backoffice`. Gated by
`requirePermission("platform:manage")`.

- **Table.** One row per catalog entry. Columns: key, category (badge),
  enabled toggle, channel multi-select (filtered to
  `supportedChannels`), subject-override button (opens i18n drawer).
- **Row states.** A row with no `notificationSettings` doc shows the
  catalog defaults in muted type; on first edit, a Firestore doc is
  created.
- **Detail drawer (v2).** Recent dispatches (last 100 from
  `notificationDispatchLog`), bounce rate, last error. Ships with the
  dispatch-log table, not in v1.
- **Writes.** `PUT /v1/admin/notifications/:key` with body
  `{ enabled, channels, subjectOverride? }`. Emits
  `notification.setting_updated` → audit log.

All mutations are append-update on the `notificationSettings/{key}`
document (creating if missing). No soft-delete — disabling is
`enabled: false`, not removal.

---

## 13. User preferences UX (v1 = Phase 3)

Route: `/settings/notifications` on both `apps/web-participant` and
`apps/web-backoffice`.

- **Grouping.** One section per `NotificationCategory`: auth (read-only,
  shown for transparency), transactional, organizational, billing,
  marketing.
- **Toggles.** One per catalog key. Disabled (greyed) and annotated
  "requis pour votre compte" when `!userOptOutAllowed`.
- **Master switches.** "Pause all marketing" toggles every
  `category === "marketing"` key in one action. Renders on top of the
  marketing section.
- **Persistence.** `PATCH /v1/users/me/notification-preferences` with
  `{ byKey: { "registration.created": true, "digest.weekly": false } }`.
  Backed by `users/{uid}.notificationPreferences.byKey` (Firestore
  rules already allow the user to write their own document with
  field-level restrictions — `byKey` will be added to the permitted
  set).

---

## 14. Future channels (design-for, build-later)

Each additional channel is one new `ChannelAdapter` implementation plus
provider credentials. The dispatcher contract is already channel-agnostic.

- **SMS.** Provider: Africa's Talking. Gated by the `smsNotifications`
  plan feature (§CLAUDE.md freemium matrix — Pro+ only). Only catalog
  keys with `supportedChannels.includes("sms")` appear in the admin
  multi-select. Adapter reads `recipient.phone` and formats for
  Senegalese numbers (+221).
- **Push.** Provider: FCM. Subscribes users to per-key topics
  (`teranga-${env}-${key}`) on login so organizers can send without
  accumulating device token lists. Adapter reads `recipient.fcmTokens`
  as fallback for targeted sends.
- **In-app.** Storage: Firestore subcollection `users/{uid}/inbox` with
  a real-time listener on the web + mobile clients. Adapter writes
  `{ key, params, readAt: null }` docs.

Each adapter is a file in `apps/api/src/services/notifications/channels/`
implementing the `ChannelAdapter` interface. Dispatcher stays untouched
when adding a channel.

---

## 15. Backward-compatibility migration

The ten existing helpers on `apps/api/src/services/email.service.ts`
(lines 402-516) — `sendRegistrationConfirmation`,
`sendRegistrationApproved`, `sendBadgeReady`, `sendEventCancelled`,
`sendEventReminder`, `sendWelcome`, `sendPaymentReceipt`,
`sendNewsletterConfirmation`, `sendEmailVerification`,
`sendPasswordReset` — become thin shims:

```ts
async sendRegistrationConfirmation(params: RegistrationConfirmationParams) {
  if (!process.env.NOTIFICATIONS_DISPATCHER_ENABLED) {
    return this._legacySendRegistrationConfirmation(params); // original body
  }
  return notificationService.dispatch({
    key: "registration.created",
    recipients: [{ userId: params.userId, email: params.email, preferredLocale: params.locale }],
    params,
    idempotencyKey: `${params.eventId}:${params.userId}:registration.created`,
  });
}
```

Callers (listeners, services) are untouched. The feature flag
`NOTIFICATIONS_DISPATCHER_ENABLED` rolls out per environment:

1. Ship dispatcher + catalog + settings API with flag **off**. All
   helpers still take the legacy path. Only the admin UI is visible.
2. Flip flag in staging. Run the 10 seeded notifications through the new
   path. Compare rendered output byte-for-byte against legacy.
3. Flip in production. Monitor `notification.sent` / `notification.suppressed`
   rates for anomalies for one week.
4. Remove the legacy `_legacy*` bodies and the flag.

Rollback at any stage is a flag flip.

---

## 16. Testing strategy

**Dispatcher unit tests** (`apps/api/src/services/notifications/__tests__/dispatcher.test.ts`):

- Happy path — catalog hit + no override + no opt-out → adapter called once per channel.
- Admin disabled short-circuit — `override.enabled = false` → zero adapter calls, one `notification.suppressed` event.
- User opt-out path — respected when `userOptOutAllowed = true`; ignored when `false`.
- Suppression list path — email in `emailSuppressions` → email channel skipped, push channel still delivered.
- Security-category bypass — `auth.password_reset` with `userOptOutAllowed = false` ignores user preference.
- Idempotency dedup — two back-to-back calls with the same key + recipient + `params.id` produce one provider call.
- Locale fallback — missing `wo` translation falls back to `fr` and logs a translation-missing warning.

**Settings repository tests** (`apps/api/src/repositories/__tests__/notification-settings.test.ts`):

- CRUD on `notificationSettings/{key}`.
- Upsert semantics (missing doc + update == create + update).

**Audit listener tests** (extend `apps/api/src/events/__tests__/audit.listener.test.ts`):

- `notification.sent` → one `auditLogs` row with the right actor/target/meta shape.
- `notification.suppressed` → reason propagated.
- `notification.setting_updated` → actor uid recorded.

**Catalog lint** (CI check in `apps/api` or as a `shared-types` build step):

- Every `defaultChannels` entry ⊂ `supportedChannels`.
- Every channel in `supportedChannels` has a matching key in `templates`.
- Every `triggerDomainEvent` exists in `apps/api/src/events/domain-events.ts`.
- Every `key` is unique and matches `/^[a-z]+(\.[a-z_]+)+$/`.

---

## 17. Cross-links

- Audit findings (what led to this design): `./notification-audit-2026-04-21.md`
- Implementation roadmap (phases 1-4): `./notification-system-roadmap.md`
- Deliverability runbook (DMARC, sender identity): `./email-deliverability.md`
- Wave 7 (Communications): `./delivery-plan/wave-7-communications.md`
