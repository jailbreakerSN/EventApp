/**
 * Organizer overhaul — Phase O8.
 *
 * Per-event "staff radio" — internal chat scoped to the event window.
 * Lightweight: append-only collection of `{eventId, authorId, body}`
 * docs ordered by `createdAt`. The frontend listens via Firestore
 * realtime to keep messages flowing without polling.
 *
 * Permission model:
 *   - Posting + reading require `checkin:scan` (staff baseline).
 *   - Cross-org reads forbidden — `requireOrganizationAccess` always
 *     checked.
 *
 * No deletion endpoint by design: staff radio is the field log; an
 * eraser would be a forensic anti-pattern. Future moderation can
 * flip a `hidden: true` flag without removing the row.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { CreateStaffMessageDto, StaffMessage } from "@teranga/shared-types";

class StaffMessageService extends BaseService {
  async post(eventId: string, dto: CreateStaffMessageDto, user: AuthUser): Promise<StaffMessage> {
    this.requirePermission(user, "checkin:scan");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const ref = db.collection(COLLECTIONS.STAFF_MESSAGES).doc();
    const message: StaffMessage = {
      id: ref.id,
      eventId,
      organizationId: event.organizationId,
      authorId: user.uid,
      authorName: user.email ?? user.uid,
      body: dto.body,
      createdAt: new Date().toISOString(),
    };
    await ref.set(message);

    // Forensic trail — we audit the FACT a message was posted, not
    // the body. The id is enough to retrieve the row during a
    // moderation review (privacy-first, mirrors the participant
    // profile pattern).
    const ctx = getRequestContext();
    eventBus.emit("staff_message.posted", {
      actorId: user.uid,
      requestId: ctx?.requestId ?? "unknown",
      timestamp: new Date().toISOString(),
      messageId: ref.id,
      eventId,
      organizationId: event.organizationId,
    });

    return message;
  }

  /**
   * List the most recent N messages (default 100) for an event.
   * Frontend consumers prefer the realtime listener; this REST
   * endpoint is the cold-start fallback + the test harness.
   */
  async list(eventId: string, user: AuthUser, limit: number = 100): Promise<StaffMessage[]> {
    this.requirePermission(user, "checkin:scan");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const snap = await db
      .collection(COLLECTIONS.STAFF_MESSAGES)
      .where("eventId", "==", eventId)
      .orderBy("createdAt", "desc")
      .limit(Math.min(limit, 200))
      .get();
    // Reverse so the consumer renders oldest → newest like a chat.
    return snap.docs.map((d) => d.data() as StaffMessage).reverse();
  }
}

export const staffMessageService = new StaffMessageService();
