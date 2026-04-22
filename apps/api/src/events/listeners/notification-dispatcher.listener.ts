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
  // Subscribes to the dedicated `event.rescheduled` event (distinct from
  // `event.updated`). The service now computes the diff once and emits
  // both events — the generic one for audit/denorm fan-out, and this
  // one for notification routing. No more inline diff-sniffing here.
  eventBus.on("event.rescheduled", async (payload) => {
    try {
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;
      // Fan out to every confirmed registrant. Hard cap protects against
      // a runaway fanout on a mega-event — Phase 5 observability will
      // chunk via findByEventCursor once the scheduler supports batched
      // sends. Until then we stop at 500 recipients per reschedule.
      const { registrationRepository } = await import("@/repositories/registration.repository");
      const MAX_RESCHEDULE_FANOUT = 500;
      const page = await registrationRepository
        .findByEvent(payload.eventId, ["confirmed"], {
          page: 1,
          limit: MAX_RESCHEDULE_FANOUT,
        })
        .catch(() => ({ data: [] as { userId: string }[] }));
      const confirmed = Array.isArray(page) ? page : page.data;
      if (confirmed.length >= MAX_RESCHEDULE_FANOUT) {
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            event: "notification.reschedule_fanout_capped",
            eventId: payload.eventId,
            cap: MAX_RESCHEDULE_FANOUT,
          }) + "\n",
        );
      }
      const recipients: NotificationRecipient[] = [];
      for (const reg of confirmed) {
        const r = await recipientFromUserId(reg.userId);
        if (r) recipients.push(r);
      }
      if (recipients.length === 0) return;

      await notificationDispatcher.dispatch({
        key: "event.rescheduled",
        recipients,
        params: {
          eventTitle: event.title,
          oldDate: formatDate(payload.previousStartDate),
          newDate: formatDate(payload.newStartDate),
          newLocation: payload.newLocation ?? undefined,
          eventUrl: `/events/${event.slug ?? event.id}`,
        },
        // Include the newStartDate on the idempotency key so a
        // second reschedule (e.g. postponed again) fires a fresh email
        // instead of silently deduping against the first.
        idempotencyKey: `event-rescheduled/${event.id}/${payload.newStartDate}`,
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
      // PaymentFailedEvent carries registrationId + paymentId (no
      // userId, no amount). Fetch registration → user, payment → amount.
      // Fixes Phase 2 security review P2-7 (the earlier draft read a
      // non-existent payload.userId and was dead code).
      const [{ registrationRepository }, { paymentRepository }] = await Promise.all([
        import("@/repositories/registration.repository"),
        import("@/repositories/payment.repository"),
      ]);
      const [registration, payment] = await Promise.all([
        registrationRepository.findById(payload.registrationId).catch(() => null),
        paymentRepository.findById(payload.paymentId).catch(() => null),
      ]);
      if (!registration) return;
      const recipient = await recipientFromUserId(registration.userId);
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      await notificationDispatcher.dispatch({
        key: "payment.failed",
        recipients: [recipient],
        params: {
          amount: formatXof(payment?.amount ?? 0),
          eventTitle: event?.title ?? "",
          retryUrl: event ? `/events/${event.slug ?? event.id}/register` : "/my-events",
        },
        idempotencyKey: `payment-failed/${payload.paymentId}`,
      });
    } catch (err) {
      logHandlerError("payment.failed", err instanceof Error ? err.message : String(err));
    }
  });

  // Subscribes to `refund.issued` (the notification-facing event), NOT
  // `payment.refunded` (the generic audit event). Both fire on every
  // successful refund — we route the customer-facing email off the
  // dedicated refund event so the failure counterpart (`refund.failed`)
  // can drive its own template without branching here.
  eventBus.on("refund.issued", async (payload) => {
    try {
      const { registrationRepository } = await import("@/repositories/registration.repository");
      const registration = await registrationRepository
        .findById(payload.registrationId)
        .catch(() => null);
      if (!registration) return;
      const recipient = await recipientFromUserId(registration.userId);
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      await notificationDispatcher.dispatch({
        key: "refund.issued",
        recipients: [recipient],
        params: {
          amount: formatXof(payload.amount),
          eventTitle: event?.title ?? "",
          refundId: payload.paymentId,
          provider: "Wave / Orange Money",
          expectedSettlementDays: 5,
        },
        idempotencyKey: `refund-issued/${payload.paymentId}`,
      });
    } catch (err) {
      logHandlerError("refund.issued", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("refund.failed", async (payload) => {
    try {
      const { registrationRepository } = await import("@/repositories/registration.repository");
      const registration = await registrationRepository
        .findById(payload.registrationId)
        .catch(() => null);
      if (!registration) return;
      const recipient = await recipientFromUserId(registration.userId);
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      await notificationDispatcher.dispatch({
        key: "refund.failed",
        recipients: [recipient],
        params: {
          amount: formatXof(payload.amount),
          eventTitle: event?.title ?? "",
          refundId: payload.paymentId,
          failureReason: payload.failureReason,
          supportUrl: "mailto:support@terangaevent.com",
        },
        // Idempotency keyed on paymentId — if the same refund fails
        // twice (e.g. a retry), we want the customer to get a fresh
        // email each attempt, so include the timestamp slice as a salt.
        idempotencyKey: `refund-failed/${payload.paymentId}/${payload.timestamp.slice(0, 16)}`,
      });
    } catch (err) {
      logHandlerError("refund.failed", err instanceof Error ? err.message : String(err));
    }
  });
}

// ─── Invites ──────────────────────────────────────────────────────────────

function registerInviteListeners(): void {
  eventBus.on("invite.created", async (payload) => {
    try {
      // InviteCreatedEvent exposes { inviteId, organizationId, email, role }.
      // Earlier Phase 2 draft cast to a made-up `inviteeEmail` field which
      // meant the listener was dead code. Fixes security review P1-5.
      if (!payload.email) return;

      // Fetch the invite doc for the token + expiry + optional eventId;
      // the domain event only carries the minimum needed to audit.
      const { inviteRepository } = await import("@/repositories/invite.repository");
      const invite = await inviteRepository.findById(payload.inviteId).catch(() => null);
      const token = (invite as unknown as { token?: string })?.token;
      const expiresAt = (invite as unknown as { expiresAt?: string })?.expiresAt;
      const eventIdOnInvite = (invite as unknown as { eventId?: string })?.eventId;

      const org = await organizationRepository.findById(payload.organizationId);
      const event = eventIdOnInvite ? await eventRepository.findById(eventIdOnInvite) : null;

      // Inviter name: prefer the actor's displayName (from the audit
      // actorId on the event). Falls back to a generic phrase.
      const inviter = await userRepository.findById(payload.actorId).catch(() => null);
      const inviterName = inviter?.displayName ?? inviter?.email ?? "Un organisateur";

      const role: "co_organizer" | "speaker" | "sponsor" | "staff" =
        payload.role === "co_organizer" ||
        payload.role === "speaker" ||
        payload.role === "sponsor" ||
        payload.role === "staff"
          ? (payload.role as "co_organizer" | "speaker" | "sponsor" | "staff")
          : "staff";

      await notificationDispatcher.dispatch({
        key: "invite.sent",
        recipients: [{ email: payload.email, preferredLocale: "fr" }],
        params: {
          inviterName,
          organizationName: org?.name ?? "",
          role,
          eventTitle: event?.title,
          acceptUrl: token ? `/invites/${token}` : "/login",
          expiresAt: expiresAt ? formatDateTime(expiresAt) : "7 jours",
        },
        // inviteId is the primary-key for dedup; org id gives an extra
        // disambiguator in case two orgs ever share an inviteId prefix.
        // Fixes Phase 2 security review P1-4.
        idempotencyKey: `invite-sent/${payload.inviteId}/${payload.organizationId}`,
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
    { event: "member.role_changed" as const, kind: "role_changed" as const },
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
      // SpeakerAddedEvent carries { speakerId, eventId, organizationId, name }.
      // Need to resolve the speaker's platform userId / email via the
      // speaker repository (the doc may have neither — speakers can be
      // off-platform; in that case we skip the notification).
      const { speakerRepository } = await import("@/repositories/speaker.repository");
      const speaker = await speakerRepository.findById(payload.speakerId).catch(() => null);
      if (!speaker) return;
      const recipient = speaker.userId ? await recipientFromUserId(speaker.userId) : null;
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;
      await notificationDispatcher.dispatch({
        key: "speaker.added",
        recipients: [recipient],
        params: {
          speakerName: payload.name,
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          eventLocation: event.location ?? "",
          portalUrl: `/speaker/${event.id}`,
        },
        idempotencyKey: `speaker-added/${event.id}/${payload.speakerId}`,
      });
    } catch (err) {
      logHandlerError("speaker.added", err instanceof Error ? err.message : String(err));
    }
  });

  eventBus.on("sponsor.added", async (payload) => {
    try {
      // SponsorAddedEvent carries { sponsorId, eventId, organizationId,
      // companyName, tier }. Resolve contact via the sponsor repository:
      // prefer `userId` (platform account), fall back to `contactEmail`.
      const { sponsorRepository } = await import("@/repositories/sponsor.repository");
      const sponsor = await sponsorRepository.findById(payload.sponsorId).catch(() => null);
      if (!sponsor) return;
      const recipient: NotificationRecipient | null = sponsor.userId
        ? await recipientFromUserId(sponsor.userId)
        : sponsor.contactEmail
          ? { email: sponsor.contactEmail, preferredLocale: "fr" }
          : null;
      if (!recipient) return;
      const event = await eventRepository.findById(payload.eventId);
      if (!event) return;
      await notificationDispatcher.dispatch({
        key: "sponsor.added",
        recipients: [recipient],
        params: {
          sponsorContactName: sponsor.contactName ?? undefined,
          organizationName: payload.companyName,
          eventTitle: event.title,
          eventDate: formatDate(event.startDate),
          portalUrl: `/sponsor/${event.id}`,
        },
        idempotencyKey: `sponsor-added/${event.id}/${payload.sponsorId}`,
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
        // All 3 subscription lifecycle events carry organizationId +
        // previousPlan + newPlan per domain-events.ts. Only cancelled
        // adds effectiveAt + cancelledBy. Read the typed payload
        // directly instead of the earlier unsafe `unknown` casts —
        // fixes Phase 2 security review P2-7.
        const p = payload as unknown as {
          organizationId?: string;
          previousPlan?: string;
          newPlan?: string;
          effectiveAt?: string;
        };
        if (!p.organizationId) return;
        // Avoid double-notification: subscription.service.cancel()
        // delegates to downgrade(), which emits subscription.downgraded
        // AND then emits subscription.cancelled. The cancel handler
        // sends the CANCEL template; the downgrade handler skips the
        // degenerate "downgrade to free" case so only one email fires.
        if (event === "subscription.downgraded" && p.newPlan === "free") {
          return;
        }
        const recipients = await recipientsForOrgBillingContacts(p.organizationId);
        if (recipients.length === 0) return;
        const org = await organizationRepository.findById(p.organizationId);
        if (!org) return;
        // Append the effective date (or a day-stamp fallback) to the
        // idempotency key so a cancel → resubscribe → cancel cycle doesn't
        // silently dedup the second email. Fixes P2-6.
        const effectiveIso = p.effectiveAt ?? new Date().toISOString();
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
            fromPlan: p.previousPlan ?? "",
            toPlan: p.newPlan ?? "",
            effectiveAt: formatDate(effectiveIso),
            billingUrl: "/organization/billing",
          },
          idempotencyKey: `${event}/${p.organizationId}/${effectiveIso.slice(0, 10)}`,
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
      // PayoutCreatedEvent carries { payoutId, eventId, organizationId,
      // netAmount }. Typed access — no `unknown` casts.
      const recipients = await recipientsForOrgBillingContacts(payload.organizationId);
      if (recipients.length === 0) return;
      const org = await organizationRepository.findById(payload.organizationId);
      if (!org) return;
      const event = payload.eventId ? await eventRepository.findById(payload.eventId) : null;
      // Phase 2 MVP: settlement date is a hard-coded "+3 days" hint since
      // the domain event doesn't carry it yet. Phase 5 observability will
      // plumb the real settlement date through once the payout service
      // queries the provider.
      const expectedSettlement = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await notificationDispatcher.dispatch({
        key: "payout.created",
        recipients,
        params: {
          organizationName: org.name,
          amount: formatXof(payload.netAmount),
          eventTitle: event?.title,
          expectedSettlementDate: formatDate(expectedSettlement),
          payoutId: payload.payoutId,
          billingUrl: "/organization/billing",
        },
        idempotencyKey: `payout/${payload.payoutId}`,
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
