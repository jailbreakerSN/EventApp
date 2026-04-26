/**
 * Organizer overhaul — Phase O9.
 *
 * Post-event report read-model. The `post-event-report.service.ts`
 * aggregates a single, denormalised JSON snapshot that powers:
 *
 *   - `/events/[id]/post-event` UI (3 cards: attendance, comms, finance,
 *      + cohort table).
 *   - `GET /v1/events/:id/post-event-report.pdf` (server-rendered PDF
 *      via pdf-lib).
 *   - `GET /v1/events/:id/post-event-report/cohort.csv` (segmented
 *      participant export).
 *
 * Why a single read-model instead of N endpoints: the PDF and the UI
 * surface exactly the same numbers — splitting the aggregation across
 * services would let the two drift out of sync. Audit also benefits: a
 * single `post_event_report.generated` event captures the snapshot the
 * organizer saw at "click time".
 *
 * What's NOT in the snapshot (deliberate gaps, see O9 notes):
 *   - Open / click rates per broadcast — the comms platform tracks
 *     `sentCount` / `failedCount` but not opens. Re-introduce when the
 *     email provider's webhooks land.
 *   - NPS — no survey collection mechanism exists yet. The cohort
 *     export ships an empty `npsBucket` field as a forward-compat hook.
 *   - Demographic breakdown by gender / age / country — not collected
 *     at registration time. We surface what IS in the data: ticket
 *     type, access zone, language preference.
 */

import { z } from "zod";

// ─── Attendance ──────────────────────────────────────────────────────────

export const AttendanceBreakdownSchema = z.object({
  /** Total registrations in any state but `cancelled`. */
  registered: z.number().int().min(0),
  /** Registrations with `status === "checked_in"`. */
  checkedIn: z.number().int().min(0),
  /** Registrations cancelled before the event. */
  cancelled: z.number().int().min(0),
  /**
   * Estimated no-shows = `registered` − `checkedIn` once the event has
   * ended. 0 before the event ends.
   */
  noShow: z.number().int().min(0),
  /** Check-in rate as a percentage 0–100, computed = checkedIn / registered. */
  checkinRatePercent: z.number().int().min(0).max(100),
});
export type AttendanceBreakdown = z.infer<typeof AttendanceBreakdownSchema>;

// ─── Demographic breakdowns ──────────────────────────────────────────────
//
// Only signals that are actually present in registrations / users are
// surfaced. Each row is `{ key, label, count }` so the consumer (PDF,
// table) can render uniformly regardless of which dimension it's
// reading.

export const BreakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
});
export type BreakdownRow = z.infer<typeof BreakdownRowSchema>;

export const DemographicBreakdownSchema = z.object({
  /** Repartition par type de billet (ticket type id → count). */
  byTicketType: z.array(BreakdownRowSchema),
  /** Repartition par zone d'accès (zone id → count). */
  byAccessZone: z.array(BreakdownRowSchema),
  /** Repartition par langue préférée du compte (`fr` / `en` / `wo`). */
  byLanguage: z.array(BreakdownRowSchema),
});
export type DemographicBreakdown = z.infer<typeof DemographicBreakdownSchema>;

// ─── Comms performance ───────────────────────────────────────────────────

export const CommsPerformanceSchema = z.object({
  /** Number of broadcasts in `sent` status for this event. */
  broadcastsSent: z.number().int().min(0),
  /** Sum of `recipientCount` across sent broadcasts. */
  totalRecipients: z.number().int().min(0),
  /** Sum of `sentCount` across sent broadcasts. */
  totalDispatched: z.number().int().min(0),
  /** Sum of `failedCount` across sent broadcasts. */
  totalFailed: z.number().int().min(0),
  /** Per-channel split — emails, sms, push, whatsapp, in_app dispatched. */
  perChannel: z.array(BreakdownRowSchema),
});
export type CommsPerformance = z.infer<typeof CommsPerformanceSchema>;

// ─── Financial summary ───────────────────────────────────────────────────
//
// The reconciliation service produces the same numbers; we copy them
// into the report so the organizer can compare attendance vs. revenue
// without a second round trip.

export const FinancialSummarySchema = z.object({
  /** Sum of `payment.amount` across `succeeded` payments — gross XOF. */
  grossAmount: z.number().int().min(0),
  /** Sum of `payment.refundedAmount`. */
  refundedAmount: z.number().int().min(0),
  /** `grossAmount − refundedAmount`. */
  netRevenue: z.number().int().min(0),
  /** Platform fee (computed via `computePlatformFee`). */
  platformFee: z.number().int().min(0),
  /** `netRevenue − platformFee` — net dû à l'organisateur. */
  payoutAmount: z.number().int().min(0),
  /** Number of paid registrations (succeeded payments, distinct registrationId). */
  paidRegistrations: z.number().int().min(0),
  /** Currency — locked to XOF for now. */
  currency: z.literal("XOF"),
});
export type FinancialSummary = z.infer<typeof FinancialSummarySchema>;

// ─── Reconciliation table row ────────────────────────────────────────────
//
// One row per `(method, status)` group so the organizer sees the split
// between Wave / Orange Money / mock + succeeded / refunded volumes.

export const ReconciliationRowSchema = z.object({
  method: z.string(),
  status: z.string(),
  count: z.number().int().min(0),
  totalAmount: z.number().int().min(0),
  refundedAmount: z.number().int().min(0),
  netAmount: z.number().int().min(0),
});
export type ReconciliationRow = z.infer<typeof ReconciliationRowSchema>;

export const ReconciliationSummarySchema = z.object({
  eventId: z.string(),
  organizationId: z.string(),
  rows: z.array(ReconciliationRowSchema),
  totals: FinancialSummarySchema,
  /**
   * ISO timestamp of the latest payment scanned (or null if none).
   * Used by the UI to disclose data freshness.
   */
  lastPaymentAt: z.string().datetime().nullable(),
  computedAt: z.string().datetime(),
});
export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;

// ─── Top-level report ────────────────────────────────────────────────────

export const PostEventReportSchema = z.object({
  eventId: z.string(),
  organizationId: z.string(),
  eventTitle: z.string(),
  eventStartDate: z.string().datetime(),
  eventEndDate: z.string().datetime().nullable(),
  attendance: AttendanceBreakdownSchema,
  demographics: DemographicBreakdownSchema,
  comms: CommsPerformanceSchema,
  financial: FinancialSummarySchema,
  /** ISO timestamp of when this snapshot was computed. */
  computedAt: z.string().datetime(),
  /**
   * `true` when the event's `endDate` is in the past (or `startDate +
   * 12h` if no `endDate`). Some numbers (no-show, payout) are only
   * meaningful once the event ends — the UI dims them otherwise.
   */
  isFinal: z.boolean(),
});
export type PostEventReport = z.infer<typeof PostEventReportSchema>;

// ─── Cohort export ───────────────────────────────────────────────────────
//
// Segments participants by attendance + payment state so the organizer
// can run a fidelisation campaign post-event ("merci d'être venu" vs.
// "désolé qu'on vous ait raté"). The CSV row mirrors what's in
// `Registration` + `Payment`, scrubbed of internal ids that don't help
// the campaign.

export const CohortSegmentSchema = z.enum([
  "attended", // checked in
  "no_show", // confirmed but not checked in (event ended)
  "cancelled", // cancelled
  "all", // every row, no filter
]);
export type CohortSegment = z.infer<typeof CohortSegmentSchema>;

export const CohortRowSchema = z.object({
  registrationId: z.string(),
  userId: z.string(),
  participantName: z.string().nullable(),
  participantEmail: z.string().nullable(),
  ticketTypeName: z.string().nullable(),
  status: z.string(),
  checkedInAt: z.string().nullable(),
  amountPaid: z.number().int().min(0),
  refundedAmount: z.number().int().min(0),
  /** Forward-compat — empty until NPS collection is wired in a later wave. */
  npsBucket: z.string().nullable(),
});
export type CohortRow = z.infer<typeof CohortRowSchema>;
