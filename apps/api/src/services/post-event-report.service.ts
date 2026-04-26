/**
 * Organizer overhaul — Phase O9.
 *
 * Single read-model that powers the post-event surface:
 *   - the `/events/:id/post-event` UI,
 *   - the PDF export,
 *   - the cohort CSV.
 *
 * The aggregation runs three Firestore reads in parallel:
 *   1. Registrations — for attendance + demographic counts.
 *   2. Payments — for the financial summary (delegated to
 *      `computeReconciliation()` so the math stays single-sourced).
 *   3. Broadcasts — for the comms performance.
 * Plus a chunked `db.getAll()` for user language preferences (capped
 * to 30 ids per chunk — Firestore's `in` limit).
 *
 * Permission: `event:read` — same gate as the rest of the event-detail
 * surface. Cross-org access blocked via `requireOrganizationAccess`.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { broadcastRepository } from "@/repositories/broadcast.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { ValidationError } from "@/errors/app-error";
import { computeReconciliation } from "./reconciliation.service";
import { payoutService } from "./payout.service";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  AttendanceBreakdown,
  Broadcast,
  BreakdownRow,
  CommsPerformance,
  CommunicationChannel,
  DemographicBreakdown,
  Event,
  Payout,
  PostEventReport,
  Registration,
  UserProfile,
} from "@teranga/shared-types";

const FALLBACK_DURATION_HOURS = 12;
const ONE_HOUR_MS = 60 * 60 * 1000;

class PostEventReportService extends BaseService {
  async getReport(eventId: string, user: AuthUser): Promise<PostEventReport> {
    this.requirePermission(user, "event:read");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // ── Parallel reads ──────────────────────────────────────────────────
    const [registrationsPage, paymentsPage, broadcastsPage] = await Promise.all([
      // 5000 cap — same upper bound the registration list uses for the
      // backoffice export, and well above any realistic event volume.
      db
        .collection(COLLECTIONS.REGISTRATIONS)
        .where("eventId", "==", eventId)
        .limit(5000)
        .get()
        .then((snap) => snap.docs.map((d) => d.data() as Registration)),
      paymentRepository.findByEvent(eventId, {}, { page: 1, limit: 10000 }).then((res) => res.data),
      broadcastRepository.findByEvent(eventId, {}, { page: 1, limit: 200 }).then((res) => res.data),
    ]);

    // Language preference is cheap to attach (one user.preferredLanguage
    // per registration) and the only "demographic" we actually have on
    // file. Chunk into 30-id batches for the `in` limit.
    const userIds = Array.from(new Set(registrationsPage.map((r) => r.userId)));
    const usersById = await fetchUserLanguages(userIds);

    // ── Aggregations ────────────────────────────────────────────────────
    const now = new Date();
    const isFinal = isEventFinal(event, now);
    const attendance = computeAttendance(registrationsPage, isFinal);
    const demographics = computeDemographics(registrationsPage, event, usersById);
    const comms = computeCommsPerformance(broadcastsPage);
    const { totals: financial } = computeReconciliation(paymentsPage);

    const snapshot: PostEventReport = {
      eventId,
      organizationId: event.organizationId,
      eventTitle: event.title,
      eventStartDate: event.startDate,
      eventEndDate: event.endDate ?? null,
      attendance,
      demographics,
      comms,
      financial,
      computedAt: now.toISOString(),
      isFinal,
    };

    // Audit — every report generation logs an immutable footprint of
    // what the organizer saw. The body is small enough (no PII) to
    // include the totals in the audit payload.
    eventBus.emit("post_event_report.generated", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now.toISOString(),
      eventId,
      organizationId: event.organizationId,
      registered: attendance.registered,
      checkedIn: attendance.checkedIn,
      grossAmount: financial.grossAmount,
      payoutAmount: financial.payoutAmount,
    });

    return snapshot;
  }

  /**
   * Organizer-initiated payout request from the post-event surface.
   * Computes the period from the event's first → last succeeded
   * payment (capped to `now`) and delegates to the shared payout
   * service so the ledger sweep stays atomic.
   *
   * Emits `payout.requested` AFTER the payout is created, so the
   * audit log distinguishes the organizer-initiated path from the
   * admin or scheduled-job paths (both of which emit only
   * `payout.created`).
   */
  async requestPayout(eventId: string, user: AuthUser): Promise<Payout> {
    this.requirePermission(user, "payout:create");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const { data: payments } = await paymentRepository.findByEvent(
      eventId,
      { status: "succeeded" },
      { page: 1, limit: 10000 },
    );
    if (payments.length === 0) {
      throw new ValidationError("Aucun paiement confirmé : impossible de demander un versement.");
    }
    // Compute the smallest enclosing period — `payout.service` filters
    // payments by `[periodFrom, periodTo]` so we want bounds that
    // capture every succeeded payment for this event.
    const completedAts = payments.map((p) => p.completedAt ?? p.createdAt);
    const periodFrom = completedAts.reduce((a, b) => (a < b ? a : b));
    const periodTo = new Date().toISOString();

    const payout = await payoutService.createPayout(eventId, periodFrom, periodTo, user);

    // Distinct from `payout.created` (which the underlying service
    // already emitted) so the audit table can render an "organizer
    // requested" row tied to this surface.
    eventBus.emit("payout.requested", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      payoutId: payout.id,
      eventId,
      organizationId: event.organizationId,
      netAmount: payout.netAmount,
    });

    return payout;
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

/**
 * `true` once the event's end is in the past. We use `endDate` if
 * provided, otherwise fall back to `startDate + 12h` (same heuristic
 * the live-window helper uses on the frontend).
 */
export function isEventFinal(event: Event, now: Date): boolean {
  const startMs = new Date(event.startDate).getTime();
  const endMs = event.endDate
    ? new Date(event.endDate).getTime()
    : startMs + FALLBACK_DURATION_HOURS * ONE_HOUR_MS;
  return now.getTime() > endMs;
}

export function computeAttendance(
  registrations: ReadonlyArray<Registration>,
  isFinal: boolean,
): AttendanceBreakdown {
  let registered = 0;
  let checkedIn = 0;
  let cancelled = 0;
  for (const r of registrations) {
    if (r.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    registered += 1;
    if (r.status === "checked_in" || r.checkedInAt) {
      checkedIn += 1;
    }
  }
  // No-show only meaningful once the event ends; before then we keep
  // it at 0 (a not-yet-checked-in participant might still arrive).
  const noShow = isFinal ? Math.max(0, registered - checkedIn) : 0;
  const checkinRatePercent = registered > 0 ? Math.round((checkedIn / registered) * 100) : 0;
  return { registered, checkedIn, cancelled, noShow, checkinRatePercent };
}

export function computeDemographics(
  registrations: ReadonlyArray<Registration>,
  event: Pick<Event, "ticketTypes" | "accessZones">,
  usersById: ReadonlyMap<string, Pick<UserProfile, "preferredLanguage">>,
): DemographicBreakdown {
  const byTicketType = countByKey(
    registrations.filter((r) => r.status !== "cancelled"),
    (r) => r.ticketTypeId,
    (id) => event.ticketTypes.find((t) => t.id === id)?.name ?? id ?? "—",
  );
  const byAccessZone = countByKey(
    registrations.filter((r) => r.status !== "cancelled" && r.accessZoneId),
    (r) => r.accessZoneId ?? "—",
    (id) => event.accessZones.find((z) => z.id === id)?.name ?? id ?? "—",
  );
  const byLanguage = countByKey(
    registrations.filter((r) => r.status !== "cancelled"),
    (r) => usersById.get(r.userId)?.preferredLanguage ?? "fr",
    (lang) =>
      lang === "fr" ? "Français" : lang === "en" ? "English" : lang === "wo" ? "Wolof" : lang,
  );
  return { byTicketType, byAccessZone, byLanguage };
}

export function computeCommsPerformance(broadcasts: ReadonlyArray<Broadcast>): CommsPerformance {
  const sent = broadcasts.filter((b) => b.status === "sent");
  const broadcastsSent = sent.length;
  const totalRecipients = sent.reduce((acc, b) => acc + b.recipientCount, 0);
  const totalDispatched = sent.reduce((acc, b) => acc + b.sentCount, 0);
  const totalFailed = sent.reduce((acc, b) => acc + b.failedCount, 0);

  // Per-channel breakdown — every `sent` broadcast contributes its
  // `sentCount` to each of its channels. We don't have per-channel
  // dispatch counts (the broadcast service collapses them), so we
  // approximate by attributing the full `sentCount` to each channel
  // on that broadcast. This matches what the comms timeline UI shows.
  const perChannelMap = new Map<CommunicationChannel, number>();
  for (const b of sent) {
    for (const ch of b.channels) {
      perChannelMap.set(ch, (perChannelMap.get(ch) ?? 0) + b.sentCount);
    }
  }
  const perChannel: BreakdownRow[] = Array.from(perChannelMap.entries())
    .map(([ch, count]) => ({ key: ch, label: prettyChannel(ch), count }))
    .sort((a, b) => b.count - a.count);

  return {
    broadcastsSent,
    totalRecipients,
    totalDispatched,
    totalFailed,
    perChannel,
  };
}

function prettyChannel(ch: CommunicationChannel): string {
  switch (ch) {
    case "email":
      return "Email";
    case "sms":
      return "SMS";
    case "push":
      return "Push";
    case "whatsapp":
      return "WhatsApp";
    case "in_app":
      return "In-app";
  }
}

function countByKey<T>(
  items: ReadonlyArray<T>,
  keyOf: (item: T) => string,
  labelOf: (key: string) => string,
): BreakdownRow[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: labelOf(key), count }))
    .sort((a, b) => b.count - a.count);
}

async function fetchUserLanguages(
  userIds: ReadonlyArray<string>,
): Promise<Map<string, Pick<UserProfile, "preferredLanguage">>> {
  if (userIds.length === 0) return new Map();
  const out = new Map<string, Pick<UserProfile, "preferredLanguage">>();
  // 30 = Firestore `in` filter cap; getAll() takes refs so we don't hit
  // the same limit, but we still chunk to avoid one giant read.
  for (let i = 0; i < userIds.length; i += 30) {
    const chunk = userIds.slice(i, i + 30);
    const refs = chunk.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() as Partial<UserProfile>;
      out.set(snap.id, { preferredLanguage: data.preferredLanguage ?? "fr" });
    }
  }
  return out;
}

export const postEventReportService = new PostEventReportService();
