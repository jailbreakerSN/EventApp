import { eventBus } from "../event-bus";
import { notificationDispatcher } from "@/services/notification-dispatcher.service";
import { userRepository } from "@/repositories/user.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { type NotificationRecipient } from "@teranga/shared-types";

// ─── Notification Dispatcher Listener ──────────────────────────────────────
// Subscribes to domain events and routes each to the appropriate catalog
// key via `notificationDispatcher.dispatch()`. One listener file per
// notification family keeps the legacy notification.listener.ts (FCM + SMS +
// legacy email) untouched; Phase 2 flows through the dispatcher exclusively.
//
// Every handler follows the same shape:
//   1. Fetch whatever extra context the template needs (event title,
//      organizer info, org billing contacts) via repositories.
//   2. Build one or more `NotificationRecipient`s — each carries userId,
//      email, and preferredLocale (fr by default).
//   3. Call `notificationDispatcher.dispatch({ key, recipients, params,
//      idempotencyKey })` and exit. Errors swallowed inside dispatch.
//
// No Firestore writes happen here (audit writes are emitted by the
// dispatcher itself via notification.sent / notification.suppressed on
// the event bus). All read operations fail gracefully — if a fetch
// throws, the handler logs to stderr and returns without dispatching
// rather than crashing.

// ─── Helpers ───────────────────────────────────────────────────────────────

const FR_DATETIME = new Intl.DateTimeFormat("fr-SN", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Africa/Dakar",
});

const FR_DATE = new Intl.DateTimeFormat("fr-SN", {
  dateStyle: "full",
  timeZone: "Africa/Dakar",
});

function formatDateTime(iso: string): string {
  try {
    return FR_DATETIME.format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return FR_DATE.format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatXof(amount: number): string {
  try {
    return new Intl.NumberFormat("fr-SN", {
      style: "currency",
      currency: "XOF",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} XOF`;
  }
}

function logHandlerError(key: string, message: string): void {
  try {
    process.stderr.write(
      JSON.stringify({
        level: "error",
        event: "notification.listener_error",
        key,
        message,
      }) + "\n",
    );
  } catch {
    // never throw from a fire-and-forget path
  }
}

async function recipientFromUserId(userId: string): Promise<NotificationRecipient | null> {
  try {
    const user = await userRepository.findById(userId);
    if (!user || !user.email) return null;
    const locale =
      user.preferredLanguage === "en" || user.preferredLanguage === "wo"
        ? user.preferredLanguage
        : "fr";
    return {
      userId,
      email: user.email,
      preferredLocale: locale,
    };
  } catch {
    return null;
  }
}

async function recipientsForOrgBillingContacts(
  organizationId: string,
): Promise<NotificationRecipient[]> {
  // Billing contacts = organization owners today; switches to a dedicated
  // `billingContactIds` field when the org-scoped billing role ships.
  try {
    const org = await organizationRepository.findById(organizationId);
    if (!org) return [];
    // Billing contacts = owner (1) + any additional members. Schema has
    // `ownerId` (single) + `memberIds` (array) — merge + dedupe.
    const ids = new Set<string>([org.ownerId, ...(org.memberIds ?? [])]);
    const recipients: NotificationRecipient[] = [];
    for (const uid of ids) {
      const r = await recipientFromUserId(uid);
      if (r) recipients.push(r);
    }
    return recipients;
  } catch {
    return [];
  }
}

// ─── Registration ─────────────────────────────────────────────────────────

function registerRegistrationListeners(): void {
  eventBus.on("registration.cancelled", async (payload) => {
    try {
      const recipient = await recipientFromUserId(payload.userId);
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;
      // The cancel path doesn't currently distinguish self vs organizer on
      // the event payload (actorId === userId would indicate self, but
      // plenty of legit paths don't match). Default to "self" — the
      // content difference is small and non-adversarial; we can enrich
      // the payload with an explicit `cancelledBy` field in a follow-up.
      const cancelledBy: "self" | "organizer" =
        payload.actorId === payload.userId ? "self" : "organizer";
      await notificationDispatcher.dispatch({
        key: "registration.cancelled",
        recipients: [recipient],
        params: {
          participantName: recipient.email ?? "",
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          cancelledBy,
          eventUrl: `/events/${event.slug ?? event.id}`,
        },
        idempotencyKey: `reg-cancel/${payload.registrationId}`,
      });
    } catch (err) {
      logHandlerError("registration.cancelled", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Event lifecycle ──────────────────────────────────────────────────────

function registerEventListeners(): void {
  eventBus.on("event.updated", async (payload) => {
    // Detect reschedule: startDate or endDate in the changes payload.
    const changes = payload.changes ?? {};
    const rescheduled = "startDate" in changes || "endDate" in changes || "newStartDate" in changes;
    if (!rescheduled) return;

    try {
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;
      // Fan out to every confirmed registrant. Uses the registration
      // repository's listConfirmed helper when available; falls back to
      // a bulk query otherwise (delegated to the future listener Phase
      // 2c hardening — for now we no-op if the helper is missing).
      const { registrationRepository } = await import("@/repositories/registration.repository");
      // Find-by-event returns a paginated envelope — unwrap `.data`.
      const page = await registrationRepository
        .findByEvent(payload.eventId, ["confirmed"])
        .catch(() => ({ data: [] as { userId: string }[] }));
      const confirmed = Array.isArray(page) ? page : page.data;
      const recipients: NotificationRecipient[] = [];
      for (const reg of confirmed) {
        const r = await recipientFromUserId(reg.userId);
        if (r) recipients.push(r);
      }
      if (recipients.length === 0) return;

      const oldDate =
        typeof (changes as Record<string, unknown>).oldStartDate === "string"
          ? formatDate((changes as Record<string, string>).oldStartDate)
          : formatDate(event.startDate);
      const newDate = formatDate(event.startDate);

      await notificationDispatcher.dispatch({
        key: "event.rescheduled",
        recipients,
        params: {
          eventTitle: event.title,
          oldDate,
          newDate,
          newLocation: event.location ?? undefined,
          eventUrl: `/events/${event.slug ?? event.id}`,
        },
        idempotencyKey: `event-rescheduled/${event.id}/${event.startDate}`,
      });
    } catch (err) {
      logHandlerError("event.rescheduled", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("waitlist.promoted", async (payload) => {
    try {
      const recipient = await recipientFromUserId(payload.userId);
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;
      // 48h hold window, hard-coded in the registration service. Duplicated
      // here because the domain-event payload doesn't carry it.
      const holdExpires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      await notificationDispatcher.dispatch({
        key: "waitlist.promoted",
        recipients: [recipient],
        params: {
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          confirmUrl: `/events/${event.slug ?? event.id}/register`,
          holdExpiresAt: formatDateTime(holdExpires),
        },
        idempotencyKey: `waitlist-promoted/${payload.registrationId}`,
      });
    } catch (err) {
      logHandlerError("waitlist.promoted", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────

function registerPaymentListeners(): void {
  eventBus.on("payment.failed", async (payload) => {
    try {
      const userId = (payload as unknown as { userId?: string }).userId;
      if (!userId) return;
      const recipient = await recipientFromUserId(userId);
      if (!recipient) return;
      const event = payload.eventId ? await eventRepository.findById(payload.eventId) : null;
      const amount = (payload as unknown as { amount?: number }).amount ?? 0;
      await notificationDispatcher.dispatch({
        key: "payment.failed",
        recipients: [recipient],
        params: {
          amount: formatXof(amount),
          eventTitle: event?.title ?? "",
          failureReason: (payload as unknown as { reason?: string }).reason,
          retryUrl: event ? `/events/${event.slug ?? event.id}/register` : "/my-events",
        },
        idempotencyKey: `payment-failed/${(payload as unknown as { paymentId?: string }).paymentId ?? userId}`,
      });
    } catch (err) {
      logHandlerError("payment.failed", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("payment.refunded", async (payload) => {
    try {
      const userId = (payload as unknown as { userId?: string }).userId;
      if (!userId) return;
      const recipient = await recipientFromUserId(userId);
      if (!recipient) return;
      const event = payload.eventId ? await eventRepository.findById(payload.eventId) : null;
      const amount = (payload as unknown as { amount?: number }).amount ?? 0;
      const refundId =
        (payload as unknown as { refundId?: string; paymentId?: string }).refundId ??
        (payload as unknown as { paymentId?: string }).paymentId ??
        "";
      // Phase 2 MVP treats every refund as "issued" — the future refund
      // service will emit refund.failed explicitly and wire this handler
      // to branch on it. For now we ship the success template only.
      await notificationDispatcher.dispatch({
        key: "refund.issued",
        recipients: [recipient],
        params: {
          amount: formatXof(amount),
          eventTitle: event?.title ?? "",
          refundId,
          provider: "Wave / Orange Money",
          expectedSettlementDays: 5,
        },
        idempotencyKey: `refund-issued/${refundId}`,
      });
    } catch (err) {
      logHandlerError("refund.issued", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Invites ──────────────────────────────────────────────────────────────

function registerInviteListeners(): void {
  eventBus.on("invite.created", async (payload) => {
    try {
      const p = payload as unknown as {
        inviteeEmail?: string;
        role?: string;
        organizationId?: string;
        eventId?: string;
        inviterName?: string;
        token?: string;
        expiresAt?: string;
      };
      if (!p.inviteeEmail) return;
      const org = p.organizationId ? await organizationRepository.findById(p.organizationId) : null;
      const event = p.eventId ? await eventRepository.findById(p.eventId) : null;

      const role: "co_organizer" | "speaker" | "sponsor" | "staff" =
        p.role === "co_organizer" ||
        p.role === "speaker" ||
        p.role === "sponsor" ||
        p.role === "staff"
          ? (p.role as "co_organizer" | "speaker" | "sponsor" | "staff")
          : "staff";

      await notificationDispatcher.dispatch({
        key: "invite.sent",
        recipients: [{ email: p.inviteeEmail, preferredLocale: "fr" }],
        params: {
          inviterName: p.inviterName ?? "Un organisateur",
          organizationName: org?.name ?? "",
          role,
          eventTitle: event?.title,
          acceptUrl: p.token ? `/invites/${p.token}` : "/login",
          expiresAt: p.expiresAt ? formatDateTime(p.expiresAt) : "7 jours",
        },
        idempotencyKey: `invite-sent/${p.token ?? p.inviteeEmail}`,
      });
    } catch (err) {
      logHandlerError("invite.sent", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Members / speakers / sponsors ────────────────────────────────────────

function registerTeamListeners(): void {
  for (const { event, kind } of [
    { event: "member.added" as const, kind: "added" as const },
    { event: "member.removed" as const, kind: "removed" as const },
    { event: "member.role_updated" as const, kind: "role_changed" as const },
  ]) {
    eventBus.on(event, async (payload) => {
      try {
        const memberId = (payload as unknown as { memberId?: string }).memberId;
        const orgId = (payload as unknown as { organizationId?: string }).organizationId;
        if (!memberId || !orgId) return;
        const recipient = await recipientFromUserId(memberId);
        if (!recipient) return;
        const org = await organizationRepository.findById(orgId);
        if (!org) return;
        await notificationDispatcher.dispatch({
          key:
            event === "member.added"
              ? "member.added"
              : event === "member.removed"
                ? "member.removed"
                : "member.role_changed",
          recipients: [recipient],
          params: {
            organizationName: org.name,
            kind,
            newRole: (payload as unknown as { newRole?: string }).newRole,
            orgUrl: "/organization",
          },
          idempotencyKey: `${event}/${orgId}/${memberId}`,
        });
      } catch (err) {
        logHandlerError(event, err instanceof Error ? err.message : String(err));
      }
    });
  }

  eventBus.on("speaker.added", async (payload) => {
    try {
      const p = payload as unknown as {
        speakerId?: string;
        speakerUserId?: string;
        eventId?: string;
      };
      const userId = p.speakerUserId ?? p.speakerId;
      if (!userId || !p.eventId) return;
      const recipient = await recipientFromUserId(userId);
      if (!recipient) return;
      const event = await eventRepository.findById(p.eventId);
      if (!event) return;
      await notificationDispatcher.dispatch({
        key: "speaker.added",
        recipients: [recipient],
        params: {
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          eventLocation: event.location ?? "",
          portalUrl: `/speaker/${event.id}`,
        },
        idempotencyKey: `speaker-added/${event.id}/${userId}`,
      });
    } catch (err) {
      logHandlerError("speaker.added", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("sponsor.added", async (payload) => {
    try {
      const p = payload as unknown as {
        sponsorId?: string;
        contactUserId?: string;
        contactEmail?: string;
        organizationName?: string;
        eventId?: string;
      };
      if (!p.eventId) return;
      const event = await eventRepository.findById(p.eventId);
      if (!event) return;
      const recipient = p.contactUserId
        ? await recipientFromUserId(p.contactUserId)
        : p.contactEmail
          ? ({ email: p.contactEmail, preferredLocale: "fr" } satisfies NotificationRecipient)
          : null;
      if (!recipient) return;
      await notificationDispatcher.dispatch({
        key: "sponsor.added",
        recipients: [recipient],
        params: {
          organizationName: p.organizationName ?? "",
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          portalUrl: `/sponsor/${event.id}`,
        },
        idempotencyKey: `sponsor-added/${event.id}/${p.sponsorId ?? p.contactEmail}`,
      });
    } catch (err) {
      logHandlerError("sponsor.added", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Subscription + payout ────────────────────────────────────────────────

function registerBillingListeners(): void {
  for (const { event, kind } of [
    { event: "subscription.upgraded" as const, kind: "upgraded" as const },
    { event: "subscription.downgraded" as const, kind: "downgraded" as const },
    { event: "subscription.cancelled" as const, kind: "cancelled" as const },
  ]) {
    eventBus.on(event, async (payload) => {
      try {
        const orgId = (payload as unknown as { organizationId?: string }).organizationId;
        if (!orgId) return;
        const recipients = await recipientsForOrgBillingContacts(orgId);
        if (recipients.length === 0) return;
        const org = await organizationRepository.findById(orgId);
        if (!org) return;
        await notificationDispatcher.dispatch({
          key:
            event === "subscription.upgraded"
              ? "subscription.upgraded"
              : event === "subscription.downgraded"
                ? "subscription.downgraded"
                : "subscription.cancelled",
          recipients,
          params: {
            organizationName: org.name,
            kind,
            fromPlan: (payload as unknown as { fromPlan?: string }).fromPlan ?? "",
            toPlan: (payload as unknown as { toPlan?: string }).toPlan ?? "",
            effectiveAt: formatDate(
              (payload as unknown as { effectiveAt?: string }).effectiveAt ??
                new Date().toISOString(),
            ),
            billingUrl: "/organization/billing",
          },
          idempotencyKey: `${event}/${orgId}`,
        });
      } catch (err) {
        logHandlerError(event, err instanceof Error ? err.message : String(err));
      }
    });
  }

  eventBus.on("subscription.past_due", async (payload) => {
    try {
      const recipients = await recipientsForOrgBillingContacts(payload.organizationId);
      if (recipients.length === 0) return;
      const org = await organizationRepository.findById(payload.organizationId);
      if (!org) return;
      await notificationDispatcher.dispatch({
        key: "subscription.past_due",
        recipients,
        params: {
          organizationName: org.name,
          planName: payload.planKey,
          amount: payload.amount,
          failureReason: payload.failureReason,
          retryUrl: "/organization/billing",
          gracePeriodEndsAt: formatDate(payload.gracePeriodEndsAt),
        },
        idempotencyKey: `past-due/${payload.organizationId}/${payload.gracePeriodEndsAt}`,
      });
    } catch (err) {
      logHandlerError("subscription.past_due", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("payout.created", async (payload) => {
    try {
      const recipients = await recipientsForOrgBillingContacts(payload.organizationId);
      if (recipients.length === 0) return;
      const org = await organizationRepository.findById(payload.organizationId);
      if (!org) return;
      const amount = (payload as unknown as { amount?: number }).amount ?? 0;
      const payoutId = (payload as unknown as { payoutId?: string }).payoutId ?? "";
      const eventId = (payload as unknown as { eventId?: string }).eventId;
      const event = eventId ? await eventRepository.findById(eventId) : null;
      const expectedSettlement =
        (payload as unknown as { expectedSettlementDate?: string }).expectedSettlementDate ??
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await notificationDispatcher.dispatch({
        key: "payout.created",
        recipients,
        params: {
          organizationName: org.name,
          amount: formatXof(amount),
          eventTitle: event?.title,
          expectedSettlementDate: formatDate(expectedSettlement),
          payoutId,
          billingUrl: "/organization/billing",
        },
        idempotencyKey: `payout/${payoutId}`,
      });
    } catch (err) {
      logHandlerError("payout.created", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── User lifecycle (security + welcome) ─────────────────────────────────

function registerUserListeners(): void {
  eventBus.on("user.created", async (payload) => {
    try {
      if (!payload.email) return;
      await notificationDispatcher.dispatch({
        key: "welcome",
        recipients: [
          {
            userId: payload.userId,
            email: payload.email,
            preferredLocale: "fr",
          },
        ],
        params: {
          name: payload.displayName ?? payload.email.split("@")[0] ?? "",
          appUrl: "/",
          exploreEventsUrl: "/events",
        },
        idempotencyKey: `welcome/${payload.userId}`,
      });
    } catch (err) {
      logHandlerError("welcome", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("user.password_changed", async (payload) => {
    try {
      const recipient = await recipientFromUserId(payload.userId);
      if (!recipient) return;
      await notificationDispatcher.dispatch({
        key: "user.password_changed",
        recipients: [recipient],
        params: {
          name: recipient.email ?? "",
          changedAt: formatDateTime(payload.changedAt),
          ipAddress: payload.ipAddress,
          city: payload.city,
          supportUrl: "mailto:support@terangaevent.com",
        },
        idempotencyKey: `pw-changed/${payload.userId}/${payload.changedAt}`,
      });
    } catch (err) {
      logHandlerError("user.password_changed", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("user.email_changed", async (payload) => {
    try {
      // Send to the OLD address — this is the security-alert pattern. The
      // NEW address gets a separate verification flow via auth.email_verification.
      await notificationDispatcher.dispatch({
        key: "user.email_changed",
        recipients: [
          {
            email: payload.oldEmail,
            preferredLocale: "fr",
          },
        ],
        params: {
          name: payload.oldEmail.split("@")[0] ?? "",
          oldEmail: payload.oldEmail,
          newEmail: payload.newEmail,
          changedAt: formatDateTime(payload.changedAt),
          supportUrl: "mailto:support@terangaevent.com",
        },
        idempotencyKey: `email-changed/${payload.userId}/${payload.changedAt}`,
      });
    } catch (err) {
      logHandlerError("user.email_changed", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Public ───────────────────────────────────────────────────────────────

export function registerNotificationDispatcherListeners(): void {
  registerRegistrationListeners();
  registerEventListeners();
  registerPaymentListeners();
  registerInviteListeners();
  registerTeamListeners();
  registerBillingListeners();
  registerUserListeners();
}
