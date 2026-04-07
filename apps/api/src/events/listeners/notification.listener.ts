import { eventBus } from "../event-bus";
import { notificationService } from "@/services/notification.service";
import {
  getSmsProvider,
  getEmailProvider,
  SMS_TEMPLATES,
  buildRegistrationEmail,
} from "@/providers/index";
import { userRepository } from "@/repositories/user.repository";

// ─── Notification Listener ───────────────────────────────────────────────────
// Subscribes to domain events and sends notifications as side effects.
// All operations are fire-and-forget — errors are logged, never propagated.

export function registerNotificationListeners(): void {
  eventBus.on("registration.created", async (payload) => {
    // In-app notification (push)
    await notificationService.send({
      userId: payload.registration.userId,
      type: "registration_confirmed",
      title: "Inscription confirmée",
      body: "Votre inscription a été confirmée. Votre badge sera bientôt disponible.",
      data: {
        eventId: payload.eventId,
        registrationId: payload.registration.id,
      },
    });

    // SMS notification
    try {
      const user = await userRepository.findById(payload.registration.userId);
      if (user?.phoneNumber) {
        const sms = getSmsProvider();
        await sms.send(
          user.phoneNumber,
          SMS_TEMPLATES.registrationConfirmed(payload.registration.eventTitle),
        );
      }
    } catch {
      // Fire-and-forget: SMS failure must not block
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
      if (user?.phoneNumber) {
        const sms = getSmsProvider();
        await sms.send(
          user.phoneNumber,
          SMS_TEMPLATES.registrationApproved(payload.eventTitle ?? "l'événement"),
        );
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
        if (user.phoneNumber) {
          const sms = getSmsProvider();
          await sms.send(
            user.phoneNumber,
            SMS_TEMPLATES.paymentConfirmed("votre événement", amountStr),
          );
        }

        // Email
        if (user.email) {
          const email = getEmailProvider();
          const { subject, html, text } = buildRegistrationEmail({
            participantName: user.displayName ?? user.email,
            eventTitle: "votre événement",
            eventDate: "Voir l'application",
            eventLocation: "Voir l'application",
            ticketName: "Billet payé",
            registrationId: payload.registrationId,
          });
          await email.send({ to: user.email, subject, html, text });
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
  });
}
