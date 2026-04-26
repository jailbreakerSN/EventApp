import { type JobHandler } from "./types";
import { pingHandler } from "./handlers/ping";
import { pruneExpiredInvitesHandler } from "./handlers/prune-expired-invites";
import { firestoreBackupHandler } from "./handlers/firestore-backup";
import { firestoreRestoreHandler } from "./handlers/firestore-restore";
import { expireStalePaymentsHandler } from "./handlers/expire-stale-payments";
import { releaseAvailableFundsHandler } from "./handlers/release-available-funds";
import { reconcilePaymentsHandler } from "./handlers/reconcile-payments";

/**
 * Registered admin-runner job handlers.
 *
 * Adding a job = one file in `handlers/` + one line below. Each handler
 * self-describes (title, description, input schema, danger note) so the
 * list endpoint can render a UI grid without any per-job code on the
 * frontend. Matches the `NOTIFICATION_CATALOG` pattern already used
 * elsewhere in the API.
 *
 * Why a Map and not an object literal: Map preserves insertion order,
 * keys aren't bound to object-prototype lookups (no `__proto__` foot-
 * gun with operator-supplied `jobKey`), and lookups are O(1).
 */
const handlers = new Map<string, JobHandler>([
  [pingHandler.descriptor.jobKey, pingHandler as JobHandler],
  [pruneExpiredInvitesHandler.descriptor.jobKey, pruneExpiredInvitesHandler as JobHandler],
  // Sprint-3 T4.3 closure — disaster-recovery surface.
  [firestoreBackupHandler.descriptor.jobKey, firestoreBackupHandler as JobHandler],
  [firestoreRestoreHandler.descriptor.jobKey, firestoreRestoreHandler as JobHandler],
  // P1-21 (audit L1) — closes the "expired status defined but never
  // assigned" gap by giving operators a deterministic way to flip
  // long-stale pending/processing payments to expired.
  [expireStalePaymentsHandler.descriptor.jobKey, expireStalePaymentsHandler as JobHandler],
  // Phase Finance — same logic as the hourly `releaseAvailableFunds`
  // Cloud Function, exposed under the runner so staging operators
  // (where the cron is env-disabled) and post-incident catch-ups in
  // production can both trigger it manually.
  [releaseAvailableFundsHandler.descriptor.jobKey, releaseAvailableFundsHandler as JobHandler],
  // ADR-0018 Phase 3 — same logic as the 10-min `onPaymentReconciliation`
  // Cloud Function, exposed under the runner so operators can drain an
  // IPN-miss backlog on demand (or test reconciliation in staging where
  // the cron is env-disabled).
  [reconcilePaymentsHandler.descriptor.jobKey, reconcilePaymentsHandler as JobHandler],
]);

export function getHandler(jobKey: string): JobHandler | null {
  return handlers.get(jobKey) ?? null;
}

export function listHandlers(): JobHandler[] {
  return Array.from(handlers.values());
}
