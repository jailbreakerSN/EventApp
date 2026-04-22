import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── User security events (Phase 2 notifications) ──────────────────────────
//
// Emits two security-critical domain events that the notification
// dispatcher listener subscribes to: `user.password_changed` and
// `user.email_changed`. The actual wiring into Firebase Auth triggers
// is deferred — Firebase Auth fires its own `onUserUpdated` events
// that a Cloud Function will translate into these domain events once
// Phase 3 lands. Until then this service is callable by whichever
// future auth-facing routes / admin actions need to announce a
// security change (e.g. an admin reset from /admin/users).
//
// These events are never suppressed by user opt-out — the catalog
// entries carry `userOptOutAllowed: false`. The dispatcher enforces
// that so we don't have to repeat the logic here.

export class UserSecurityEventsService {
  /**
   * Emit `user.password_changed`. Call from any code path that
   * successfully rotates a user's password (self-service, admin reset,
   * account-recovery link). `method` labels the initiator — feeds the
   * audit trail + the security-alert email copy. `ipAddress` + `city`
   * are optional best-effort enrichment (GeoIP + forwarded-for); pass
   * undefined when the change originates from a trusted server path
   * like a cron or admin tool.
   */
  emitPasswordChanged(
    userId: string,
    _method: "self_service" | "admin_reset" | "recovery",
    options: { ipAddress?: string; city?: string; actorId?: string } = {},
  ): void {
    const now = new Date().toISOString();
    eventBus.emit("user.password_changed", {
      userId,
      changedAt: now,
      ...(options.ipAddress ? { ipAddress: options.ipAddress } : {}),
      ...(options.city ? { city: options.city } : {}),
      // `actorId` defaults to the user themselves — most common case is
      // self-service. Admin-reset paths should override with the acting
      // super-admin's uid so the audit trail stays accurate.
      actorId: options.actorId ?? userId,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  /**
   * Emit `user.email_changed`. The notification listener sends a
   * security alert to the OLD address (change-of-email anti-hijack
   * pattern). `oldEmail` and `newEmail` are both required — the
   * template renders the transition explicitly ("You changed from
   * alice@old to alice@new"). `actorId` defaults to the user
   * themselves.
   */
  emitEmailChanged(
    userId: string,
    oldEmail: string,
    newEmail: string,
    options: { actorId?: string } = {},
  ): void {
    const now = new Date().toISOString();
    eventBus.emit("user.email_changed", {
      userId,
      oldEmail,
      newEmail,
      changedAt: now,
      actorId: options.actorId ?? userId,
      requestId: getRequestId(),
      timestamp: now,
    });
  }
}

export const userSecurityEventsService = new UserSecurityEventsService();
