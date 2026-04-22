import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── User lifecycle events (Phase 2 notifications) ──────────────────────────
//
// Emits the `user.created` domain event the notification dispatcher
// subscribes to (welcome email). No user-creation service currently
// lives in this repo — user docs are created by a Firebase Cloud
// Function auth trigger (`onUserCreated`). This service is the API-
// side emit point the trigger will call once Phase 3 wires it up;
// it's also callable by invite-acceptance flows and admin-provisioned
// users that need to fire a welcome email.

export type UserCreatedSource = "self_signup" | "invite" | "admin";

export class UserLifecycleService {
  /**
   * Emit `user.created`. The dispatcher listener routes to the
   * `welcome` catalog key. `source` labels the provisioning path for
   * audit and copy-variation (the welcome email mentions "you accepted
   * an invite" differently from "you signed up").
   *
   * `email` may be null for anonymous Firebase accounts — the listener
   * skips dispatch in that case, so callers don't need to filter.
   */
  emitUserCreated(
    userId: string,
    email: string | null,
    source: UserCreatedSource,
    options: { displayName?: string | null; actorId?: string } = {},
  ): void {
    const now = new Date().toISOString();
    eventBus.emit("user.created", {
      userId,
      email,
      displayName: options.displayName ?? null,
      // The catalog payload type carries `provider` (firebase auth
      // provider). `source` is a higher-level label this service adds
      // — we fold it into the provider slot for the existing UserCreatedEvent
      // contract so we don't break the already-subscribed audit listener
      // or any downstream consumer.
      provider: source,
      // `actorId` is the creator — self for self-signup, the inviter for
      // invite, the super-admin for admin-provisioned accounts. Default
      // to the user themselves when the caller doesn't know.
      actorId: options.actorId ?? userId,
      requestId: getRequestId(),
      timestamp: now,
    });
  }
}

export const userLifecycleService = new UserLifecycleService();
