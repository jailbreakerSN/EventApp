/**
 * Organizer overhaul — Phase O7.
 *
 * Bulk action runner for the registrations table. Each verb here is
 * a thin loop on top of the existing per-registration service method
 * (cancel, approve) — keeps the per-row audit trail intact while
 * giving operators a single endpoint to fire bulk ops from the UI.
 *
 * Cancellation policy (errors during a bulk run):
 *   - Each row is processed independently.
 *   - A single failure does NOT abort the whole run — we record the
 *     reason in the result and continue with the rest.
 *   - The response shape is `{ successCount, failures: [{ id, reason }] }`
 *     so the UI can display a human summary.
 *
 * The per-row throttling is intentional: Firestore writes have rate
 * limits, and the event bus emit + audit log + notification dispatch
 * downstream are not free. A 500-row max and sequential processing
 * keep the operator-facing latency predictable.
 */

import { BaseService } from "./base.service";
import { registrationService } from "./registration.service";
import type { AuthUser } from "@/middlewares/auth.middleware";

export interface BulkActionResult {
  successCount: number;
  failures: Array<{ id: string; reason: string }>;
}

class RegistrationBulkService extends BaseService {
  async bulkCancel(registrationIds: string[], user: AuthUser): Promise<BulkActionResult> {
    this.requirePermission(user, "registration:cancel_any");
    return this.runSequentially(registrationIds, (id) => registrationService.cancel(id, user));
  }

  async bulkApprove(registrationIds: string[], user: AuthUser): Promise<BulkActionResult> {
    this.requirePermission(user, "registration:approve");
    return this.runSequentially(registrationIds, (id) => registrationService.approve(id, user));
  }

  /**
   * Loops a per-row mutation over the supplied ids, collecting per-row
   * failures. Sequential by design — see header for rationale.
   */
  private async runSequentially(
    ids: string[],
    op: (id: string) => Promise<void>,
  ): Promise<BulkActionResult> {
    const failures: BulkActionResult["failures"] = [];
    let successCount = 0;
    for (const id of ids) {
      try {
        await op(id);
        successCount += 1;
      } catch (err) {
        failures.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { successCount, failures };
  }
}

export const registrationBulkService = new RegistrationBulkService();
