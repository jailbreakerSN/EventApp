import { eventBus } from "../event-bus";
import { notificationService } from "@/services/notification.service";
import { emailService } from "@/services/email.service";
import { getSmsProvider, SMS_TEMPLATES, buildRegistrationEmail } from "@/providers/index";
import { userRepository } from "@/repositories/user.repository";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { type RegistrationStatus } from "@teranga/shared-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("fr-SN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Dakar",
  }).format(new Date(isoDate));
}

// ─── Notification Listener ────────────────────────────────────────────────────
// Subscribes to domain events and sends notifications as side effects.
// All operations are fire-and-forget — errors are logged, never propagated.

export function registerNotificationListeners(): void {
  eventBus.on("registration.created", async (payload) => {
    const reg = payload.registration;

    // In-app notification (push)
    await notificationService.send({
      userId: reg.userId,
      type: "registration_confirmed",
      title: "Inscription confirmée",
      body: "Votre inscription a été confirmée. Votre badge sera bientôt disponible.",
      data: {
        eventId: payload.eventId,
        registrationId: reg.id,
      },
    });

    // SMS notification
    try {
      const user = await userRepository.findById(reg.userId);
      if (user?.phone) {
        const sms = getSmsProvider();
        await sms.send(
          user.phone,
          SMS_TEMPLATES.registrationConfirmed(reg.eventTitle ?? "l'événement"),
        );
      }
    } catch {
      // Fire-and-forget: SMS failure must not block
    }

    // Email — registration confirmation
    try {
      const event = await eventRepository.findById(payload.eventId);
      if (event) {
        await emailService.sendRegistrationConfirmation(reg.userId, {
          participantName: reg.participantName ?? "Participant",
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          eventLocation: event.location?.address ?? "Voir l'application",
          ticketName: reg.ticketTypeName ?? "Billet",
          registrationId: reg.id,
        });
      }
    } catch {
      // Fire-and-forget
    }
  });

  eventBus.on("registration.approved", async (payload) => {
    await notificationService.send({
      userId: payload.userId,
      type: "registration_approved",
      title: "Inscription approuvée",
      body: "Votre inscription a été approuvée par l'organisateur.",
      data: {
        eventId: payload.eventId,
        registrationId: payload.registrationId,
      },
    });

    // SMS notification
    try {
      const user = await userRepository.findById(payload.userId);
      if (user?.phone) {
        const sms = getSmsProvider();
        await sms.send(user.phone, SMS_TEMPLATES.registrationApproved("l'événement"));
      }
    } catch {
      // Fire-and-forget
    }

    // Email — registration approved
    try {
      const event = await eventRepository.findById(payload.eventId);
      if (event) {
        const user = await userRepository.findById(payload.userId);
        await emailService.sendRegistrationApproved(payload.userId, {
          participantName: user?.displayName ?? "Participant",
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          eventLocation: event.location?.address ?? "Voir l'application",
        });
      }
    } catch {
      // Fire-and-forget
    }
  });

  eventBus.on("payment.succeeded", async (payload) => {
    // In-app notification
    await notificationService.send({
      userId: payload.actorId,
      type: "payment_success",
      title: "Paiement confirmé",
      body: `Paiement de ${new Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" }).format(payload.amount)} reçu.`,
      data: {
        eventId: payload.eventId,
        paymentId: payload.paymentId,
      },
    });

    // SMS + Email for payment confirmation
    try {
      const user = await userRepository.findById(payload.actorId);
      if (user) {
        const amountStr = new Intl.NumberFormat("fr-SN", {
          style: "currency",
          currency: "XOF",
        }).format(payload.amount);

        // SMS
        if (user.phone) {
          const sms = getSmsProvider();
          await sms.send(user.phone, SMS_TEMPLATES.paymentConfirmed("votre événement", amountStr));
        }

        // Email — payment receipts belong to the billing category so users
        // see them come from billing@ and can reply to the same address.
        if (user.email) {
          const template = buildRegistrationEmail({
            participantName: user.displayName ?? user.email,
            eventTitle: "votre événement",
            eventDate: "Voir l'application",
            eventLocation: "Voir l'application",
            ticketName: "Billet payé",
            registrationId: payload.registrationId,
          });
          await emailService.sendDirect(user.email, template, "billing", {
            tags: [{ name: "type", value: "payment_succeeded" }],
            idempotencyKey: `payment:${payload.paymentId}`,
          });
        }
      }
    } catch {
      // Fire-and-forget
    }
  });

  eventBus.on("checkin.completed", async (payload) => {
    await notificationService.send({
      userId: payload.participantId,
      type: "check_in_success",
      title: "Check-in réussi",
      body: "Bienvenue ! Votre check-in a été enregistré.",
      data: {
        eventId: payload.eventId,
        registrationId: payload.registrationId,
      },
    });
  });

  eventBus.on("badge.generated", async (payload) => {
    await notificationService.send({
      userId: payload.userId,
      type: "badge_ready",
      title: "Badge prêt",
      body: "Votre badge est prêt à être téléchargé.",
      data: {
        eventId: payload.eventId,
        badgeId: payload.badgeId,
      },
    });

    // Email — badge ready
    try {
      const user = await userRepository.findById(payload.userId);
      const event = await eventRepository.findById(payload.eventId);
      if (user && event) {
        await emailService.sendBadgeReady(payload.userId, {
          participantName: user.displayName ?? "Participant",
          eventTitle: event.title,
        });
      }
    } catch {
      // Fire-and-forget
    }
  });

  // ─── Event Cancelled — notify all registered participants ──────────────

  eventBus.on("event.cancelled", async (payload) => {
    try {
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;

      const eventDate = formatDate(event.startDate);
      const CHUNK_SIZE = 500;
      const targetStatuses: RegistrationStatus[] = ["confirmed", "checked_in", "pending"];
      let lastDoc: FirebaseFirestore.DocumentSnapshot | undefined;
      let hasMore = true;

      while (hasMore) {
        const page = await registrationRepository.findByEventCursor(
          payload.eventId,
          targetStatuses,
          CHUNK_SIZE,
          lastDoc,
        );

        if (page.data.length === 0) break;
        lastDoc = page.lastDoc ?? undefined;
        hasMore = page.data.length === CHUNK_SIZE;

        // Send cancellation emails for this chunk
        for (const reg of page.data) {
          await emailService.sendEventCancelled(reg.userId, {
            participantName: reg.participantName ?? "Participant",
            eventTitle: event.title,
            eventDate,
          });
        }
      }
    } catch {
      // Fire-and-forget
    }
  });
}
