import { eventBus } from "../event-bus";
import { notificationService } from "@/services/notification.service";

// ─── Notification Listener ───────────────────────────────────────────────────
// Subscribes to domain events and sends notifications as side effects.
// All operations are fire-and-forget — errors are logged, never propagated.

export function registerNotificationListeners(): void {
  eventBus.on("registration.created", async (payload) => {
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
