import {
  type Broadcast,
  type CreateBroadcastDto,
  type RegistrationStatus,
} from "@teranga/shared-types";
import { broadcastRepository } from "@/repositories/broadcast.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import { notificationService } from "@/services/notification.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { getSmsProvider } from "@/providers/index";
import { emailService } from "@/services/email.service";

export class BroadcastService extends BaseService {
  /**
   * Send a broadcast to event participants.
   */
  async sendBroadcast(dto: CreateBroadcastDto, user: AuthUser): Promise<Broadcast> {
    this.requirePermission(user, "broadcast:send");

    const event = await eventRepository.findByIdOrThrow(dto.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Gate the premium channels (SMS / WhatsApp) behind their plan
    // features. Fail-fast before the broadcast record is created so
    // the org is not charged for a partial send that silently skipped
    // a channel. Fetch the org once if either gated channel is in
    // play — both gates use the same Org doc.
    const needsSms = dto.channels.includes("sms");
    const needsWhatsapp = dto.channels.includes("whatsapp");
    if (needsSms || needsWhatsapp) {
      const org = await organizationRepository.findByIdOrThrow(event.organizationId);
      if (needsSms) this.requirePlanFeature(org, "smsNotifications");
      if (needsWhatsapp) this.requirePlanFeature(org, "whatsappNotifications");
    }

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
    const targetStatuses: RegistrationStatus[] =
      dto.recipientFilter === "checked_in"
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
            const result = await getSmsProvider().sendBulk(smsMessages);
            totalSent += result.sent;
            totalFailed += result.failed;
          }
        }

        if (channel === "email") {
          const users = await Promise.all(userIds.map((uid) => userRepository.findById(uid)));
          // Respect per-user email preferences before fan-out. `sendBulk`
          // only consults the platform-wide suppression list (hard
          // bounces + complaints), NOT per-user notification prefs —
          // that contract belongs here at the call site, where we have
          // the userId context. Without this filter, any recipient who
          // toggled off "E-mails transactionnels" in Settings would
          // still receive organizer broadcasts. Fetch preferences in
          // parallel and drop anyone opted out before we hit Resend.
          const prefsList = await Promise.all(
            users.map((u) => (u ? emailService.getPreferences(u.id) : Promise.resolve(null))),
          );
          const emailMessages = users
            .map((u, i) => ({ user: u, prefs: prefsList[i] }))
            .filter(({ user, prefs }) => {
              if (!user?.email) return false;
              if (!prefs) return false;
              return emailService.isEmailCategoryEnabled(prefs, "transactional");
            })
            .map(({ user }) => ({
              to: user!.email!,
              subject: dto.title,
              html: `<h2>${dto.title}</h2><p>${dto.body}</p><hr><p><small>${event.title} — Teranga</small></p>`,
            }));

          if (emailMessages.length > 0) {
            // Organizer broadcasts are event-related comms → transactional sender.
            const result = await emailService.sendBulk(emailMessages, "transactional");
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
