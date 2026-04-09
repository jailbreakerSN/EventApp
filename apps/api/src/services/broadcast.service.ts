import {
  type Broadcast,
  type CreateBroadcastDto,
  type CommunicationChannel,
} from "@teranga/shared-types";
import { broadcastRepository } from "@/repositories/broadcast.repository";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import { notificationService } from "@/services/notification.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { mockSmsProvider } from "@/providers/mock-sms.provider";
import { mockEmailProvider } from "@/providers/mock-email.provider";

export class BroadcastService extends BaseService {
  /**
   * Send a broadcast to event participants.
   */
  async sendBroadcast(dto: CreateBroadcastDto, user: AuthUser): Promise<Broadcast> {
    this.requirePermission(user, "broadcast:send");

    const event = await eventRepository.findByIdOrThrow(dto.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const now = new Date().toISOString();

    // Create broadcast record
    const broadcast: Broadcast = {
      id: "",
      eventId: dto.eventId,
      organizationId: event.organizationId,
      title: dto.title,
      body: dto.body,
      channels: dto.channels,
      recipientFilter: dto.recipientFilter,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      status: "sending",
      createdBy: user.uid,
      createdAt: now,
      sentAt: null,
    };

    const created = await broadcastRepository.create(broadcast);
    const broadcastId = created.id;
    broadcast.id = broadcastId;

    // Determine which statuses to target
    const targetStatuses = dto.recipientFilter === "checked_in"
      ? ["checked_in"]
      : dto.recipientFilter === "not_checked_in"
        ? ["confirmed"]
        : ["confirmed", "checked_in"];

    // Fetch registrations in pages
    const CHUNK_SIZE = 500;
    let totalSent = 0;
    let totalFailed = 0;
    let totalRecipients = 0;
    let lastDoc: FirebaseFirestore.DocumentSnapshot | undefined;

    let hasMore = true;
    while (hasMore) {
      const page = await registrationRepository.findByEventCursor(
        dto.eventId,
        targetStatuses,
        CHUNK_SIZE,
        lastDoc,
      );

      if (page.data.length === 0) break;
      lastDoc = page.lastDoc ?? undefined;
      hasMore = page.data.length === CHUNK_SIZE;
      totalRecipients += page.data.length;

      // Collect user IDs for this chunk
      const userIds = page.data.map((r) => r.userId);

      // Send via each requested channel
      for (const channel of dto.channels) {
        if (channel === "push" || channel === "in_app") {
          // Use existing notification service for push + in-app
          await notificationService.broadcast(
            {
              eventId: dto.eventId,
              type: "broadcast",
              title: dto.title,
              body: dto.body,
              data: { broadcastId },
            },
            user,
          );
          totalSent += page.data.length;
        }

        if (channel === "sms") {
          // Get phone numbers from user profiles
          const users = await Promise.all(userIds.map((uid) => userRepository.findById(uid)));
          const smsMessages = users
            .filter((u) => u?.phone)
            .map((u) => ({
              to: u!.phone!,
              body: `${dto.title}\n${dto.body}`,
            }));

          if (smsMessages.length > 0) {
            const result = await mockSmsProvider.sendBulk(smsMessages);
            totalSent += result.sent;
            totalFailed += result.failed;
          }
        }

        if (channel === "email") {
          const users = await Promise.all(userIds.map((uid) => userRepository.findById(uid)));
          const emailMessages = users
            .filter((u) => u?.email)
            .map((u) => ({
              to: u!.email!,
              subject: dto.title,
              html: `<h2>${dto.title}</h2><p>${dto.body}</p><hr><p><small>${event.title} — Teranga</small></p>`,
            }));

          if (emailMessages.length > 0) {
            const result = await mockEmailProvider.sendBulk(emailMessages);
            totalSent += result.sent;
            totalFailed += result.failed;
          }
        }
      }
    }

    // Update broadcast with results
    await broadcastRepository.update(broadcastId, {
      recipientCount: totalRecipients,
      sentCount: totalSent,
      failedCount: totalFailed,
      status: totalFailed > 0 ? "failed" : "sent",
      sentAt: new Date().toISOString(),
    } as Partial<Broadcast>);

    eventBus.emit("broadcast.sent", {
      broadcastId,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      channels: dto.channels,
      recipientCount: totalRecipients,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return broadcastRepository.findByIdOrThrow(broadcastId);
  }

  /**
   * List broadcast history for an event.
   */
  async listBroadcasts(
    eventId: string,
    filters: { status?: string },
    pagination: { page: number; limit: number },
    user: AuthUser,
  ) {
    this.requirePermission(user, "broadcast:read");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);
    return broadcastRepository.findByEvent(eventId, filters, pagination);
  }
}

export const broadcastService = new BroadcastService();
