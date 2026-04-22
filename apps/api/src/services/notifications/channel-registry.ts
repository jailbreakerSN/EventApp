import {
  type ChannelAdapter,
  type NotificationChannel,
} from "@teranga/shared-types";

// ─── Channel Adapter Registry (Phase 2.6) ──────────────────────────────────
// Forward-looking registry for the multi-channel dispatcher contract defined
// in `packages/shared-types/src/notification-catalog.ts`.
//
// Today the live `NotificationDispatcherService` owns an email-only registry
// (`setEmailChannelAdapter` in `notification-dispatcher.service.ts`). We are
// intentionally NOT folding the two yet:
//   - Phase 2.2 (idempotency) is mid-flight and owns dispatcher edits.
//   - Phase 3 will wire dispatcher → this registry in a single cutover,
//     replacing the ad-hoc `adapters.email` object.
//
// Until then this registry is exercised by the stub adapters (email / sms /
// push / in_app) so the ChannelAdapter contract is live and tested.
//
// Design choice: module-level Map keyed by channel name. Singletons are fine
// because each channel has exactly one implementation at runtime; tests
// swap via `registerChannelAdapter()` (overwrite is allowed — see test).

const registry = new Map<NotificationChannel, ChannelAdapter>();

/**
 * Register (or overwrite) the adapter for a given channel. Overwrite is
 * allowed to support test isolation and hot-swapping in dev.
 */
export function registerChannelAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.channel, adapter);
}

/**
 * Look up the adapter for a channel. Returns `undefined` when no adapter
 * has been registered — callers must treat this as "channel not available"
 * and skip the send (the dispatcher will emit a `no_recipient` suppression).
 */
export function getChannelAdapter(
  channel: NotificationChannel,
): ChannelAdapter | undefined {
  return registry.get(channel);
}

/**
 * Return every registered adapter. Useful for the admin "channel readiness"
 * diagnostic endpoint and for tests that need to reset the registry.
 */
export function listChannelAdapters(): ChannelAdapter[] {
  return Array.from(registry.values());
}

/**
 * Clear all registered adapters. Test-only — production code never calls
 * this. Kept in the same module so tests don't have to reach into internal
 * state.
 */
export function __resetChannelRegistryForTests(): void {
  registry.clear();
}
