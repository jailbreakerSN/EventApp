# Notification Channel Readiness

_Last updated: 2026-04-22 — Phase 2.6 (multi-channel adapter scaffolding)._

This doc tracks which notification channels have production adapters, which
are stubs, and how a stub becomes a real adapter.

## The contract

Every channel implements the `ChannelAdapter` interface defined in
`packages/shared-types/src/notification-catalog.ts`:

```ts
interface ChannelAdapter<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly channel: NotificationChannel;           // "email" | "sms" | "push" | "in_app"
  readonly capabilities: ChannelCapabilities;      // attachments / richText / maxBodyLength / supportedLocales
  supports(definition: NotificationDefinition): boolean;  // fast sync check
  send(params: ChannelDispatchParams<P>): Promise<ChannelDispatchResult>;
}
```

Invariants the dispatcher relies on:

1. `send()` never throws. Provider errors surface as `ok: false` plus a
   machine-readable `suppressed` reason (`no_recipient`, `bounced`,
   `on_suppression_list`, etc.).
2. `supports()` is a pure, synchronous check — no Firestore reads, no async
   work. It gates whether the dispatcher touches `send()` at all.
3. `capabilities` is an honest advertisement. The admin UI reads these when
   an operator wants to check template fit ("will this 300-char body get
   truncated on SMS?").

Adapters register themselves with the forward-looking registry in
`apps/api/src/services/notifications/channel-registry.ts` via
`registerChannelAdapter(adapter)`.

## Channel status

| Channel  | Status    | Implementation                                                                                         | Notes                                                                                                                                      |
| -------- | --------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `email`  | **Live**  | `apps/api/src/services/notifications/channels/email.channel.ts` (wraps the legacy dispatcher adapter)  | Resend + react-email, category-routed via `email/sender.registry.ts`. All 30 catalog entries ship email today.                             |
| `sms`    | **Stub**  | `apps/api/src/services/notifications/channels/sms.channel.stub.ts`                                     | TODO: wire Africa's Talking. Capabilities: `{ attachments: false, richText: false, maxBodyLength: 160 }`. Currently returns `no_recipient`. |
| `push`   | **Stub**  | `apps/api/src/services/notifications/channels/push.channel.stub.ts`                                    | Real FCM path lives in `notification.service.ts` (in-app + push). Phase 6 ports the send into this adapter.                                 |
| `in_app` | **Stub**  | `apps/api/src/services/notifications/channels/in-app.channel.stub.ts`                                  | Firestore `notifications/{id}` writes currently done directly by `NotificationService.send`. Phase 6 moves them behind this adapter.        |

## Per-channel user preferences

Phase 2.6 also introduces per-channel opt-outs. A user can now drop SMS for
`event.reminder` while keeping the email version on.

- Schema: `NotificationPreferenceValue` in
  `packages/shared-types/src/notification-preferences.types.ts`. Either a
  bare boolean (legacy) or a per-channel object
  `{ email?, sms?, push?, in_app? }`.
- Resolver: `isChannelAllowedForUser(prefs, key, channel)` in
  `apps/api/src/services/notifications/channel-preferences.ts` — pure
  helper, no I/O. See the JSDoc for the full resolution table.
- Backward compat: absent entries default to allowed; bare booleans blanket
  every channel; missing channels inside an object default to allowed.

## Migration path (stub → real)

When a channel adapter goes live (e.g. SMS), the work is scoped to the
adapter file and the catalog — no dispatcher change required:

1. Replace `send()` in the stub file with the real provider call
   (Africa's Talking REST for SMS, FCM for push, Firestore write for
   in_app). Bump the capabilities if the provider differs from the stub's
   advertised shape.
2. Flip the affected catalog entries' `supportedChannels` / `defaultChannels`
   in `packages/shared-types/src/notification-catalog.ts` to include the
   new channel.
3. Rebuild shared-types (`npm run types:build`).
4. Ship the builder for that channel (SMS body template, push payload
   builder) alongside the existing react-email builder.
5. Update this doc: move the channel from "Stub" to "Live" and list the
   provider + capability profile.

The dispatcher picks up the new channel on its next request — it discovers
the adapter via `getChannelAdapter(channel)` and walks every entry in
`definition.defaultChannels`.

## Phase 3 integration pointer

The live dispatcher (`notification-dispatcher.service.ts`) still uses the
legacy `adapters.email` registry. Phase 3 folds the two:

- Replace `adapters.email` lookup with `getChannelAdapter("email")`.
- Replace the single-channel `EmailChannelAdapter` interface with the
  generic `ChannelAdapter` everywhere.
- Wire the per-channel preference check: inside the per-channel loop,
  before calling `adapter.send()`, call
  `isChannelAllowedForUser(preferences, definition.key, channel)` and emit
  `notification.suppressed(user_opted_out)` when false.

Catalog entries do NOT change during this migration — only dispatcher
plumbing.
