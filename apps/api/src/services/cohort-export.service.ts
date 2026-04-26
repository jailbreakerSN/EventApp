/**
 * Organizer overhaul — Phase O9.
 *
 * Cohort CSV export. Segments participants by attendance + payment
 * state so the organizer can run a fidelisation campaign post-event:
 *
 *   - `attended`  → participants checked in (the "thank you for
 *                    coming" cohort).
 *   - `no_show`   → registered but never checked in once the event
 *                    ended (the "we missed you" cohort).
 *   - `cancelled` → registrations cancelled before the event.
 *   - `all`       → every row regardless of state.
 *
 * Permission: `registration:export` — same gate as the existing
 * audience CSV. We emit `cohort_export.downloaded` on every call so
 * the audit log captures who pulled the participant list (PII risk).
 *
 * The CSV is RFC-4180 compliant (CRLF separator, quoted fields, BOM
 * for Excel-FR compatibility) and built with a tiny pure helper
 * `formatCsv()` exported for tests.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { isEventFinal } from "./post-event-report.service";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { CohortRow, CohortSegment, Event, Payment, Registration } from "@teranga/shared-types";

class CohortExportService extends BaseService {
  /**
   * Returns `{ csv, rowCount }` so the route can stream + log without
   * a second round trip.
   */
  async exportCsv(
    eventId: string,
    segment: CohortSegment,
    user: AuthUser,
  ): Promise<{ csv: string; rowCount: number; segment: CohortSegment }> {
    this.requirePermission(user, "registration:export");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const now = new Date();
    const isFinal = isEventFinal(event, now);

    const [registrations, payments] = await Promise.all([
      db
        .collection(COLLECTIONS.REGISTRATIONS)
        .where("eventId", "==", eventId)
        .limit(5000)
        .get()
        .then((snap) => snap.docs.map((d) => d.data() as Registration)),
      paymentRepository.findByEvent(eventId, {}, { page: 1, limit: 10000 }).then((res) => res.data),
    ]);

    const rows = buildCohortRows(registrations, payments, event, segment, isFinal);
    const csv = formatCsv(rows);

    eventBus.emit("cohort_export.downloaded", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now.toISOString(),
      eventId,
      organizationId: event.organizationId,
      segment,
      rowCount: rows.length,
    });

    return { csv, rowCount: rows.length, segment };
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

/**
 * Build the rows for a given segment. Pure — no Firestore, no
 * filesystem. Tests pass synthetic registrations + payments and pin
 * the segment filtering + payment merging logic.
 */
export function buildCohortRows(
  registrations: ReadonlyArray<Registration>,
  payments: ReadonlyArray<Payment>,
  event: Pick<Event, "ticketTypes">,
  segment: CohortSegment,
  isFinal: boolean,
): CohortRow[] {
  // Pre-aggregate payments by registrationId so the row-build is O(N).
  const paymentByReg = new Map<string, { amount: number; refunded: number }>();
  for (const p of payments) {
    if (p.status !== "succeeded") continue;
    const existing = paymentByReg.get(p.registrationId);
    if (existing) {
      existing.amount += p.amount;
      existing.refunded += p.refundedAmount;
    } else {
      paymentByReg.set(p.registrationId, {
        amount: p.amount,
        refunded: p.refundedAmount,
      });
    }
  }

  const out: CohortRow[] = [];
  for (const r of registrations) {
    if (!matchesSegment(r, segment, isFinal)) continue;
    const paid = paymentByReg.get(r.id);
    out.push({
      registrationId: r.id,
      userId: r.userId,
      participantName: r.participantName ?? null,
      participantEmail: r.participantEmail ?? null,
      ticketTypeName: event.ticketTypes.find((t) => t.id === r.ticketTypeId)?.name ?? null,
      status: r.status,
      checkedInAt: r.checkedInAt ?? null,
      amountPaid: paid?.amount ?? 0,
      refundedAmount: paid?.refunded ?? 0,
      // NPS not collected yet — empty placeholder so consumers (and
      // future integrations) can rely on the column being present.
      npsBucket: null,
    });
  }

  // Stable order by participantName ASC (then email if name is null) —
  // the CSV is consumed by humans first, machines second.
  out.sort((a, b) => {
    const an = a.participantName ?? a.participantEmail ?? "";
    const bn = b.participantName ?? b.participantEmail ?? "";
    return an.localeCompare(bn, "fr");
  });
  return out;
}

function matchesSegment(r: Registration, segment: CohortSegment, isFinal: boolean): boolean {
  switch (segment) {
    case "all":
      return true;
    case "attended":
      return r.status === "checked_in" || Boolean(r.checkedInAt);
    case "cancelled":
      return r.status === "cancelled";
    case "no_show":
      // Only meaningful once the event ended — before that, a missing
      // checkin doesn't imply absence.
      if (!isFinal) return false;
      return r.status === "confirmed" && !r.checkedInAt;
  }
}

/**
 * RFC-4180 CSV with a UTF-8 BOM for Excel-FR. The first row is a
 * static header; subsequent rows mirror `CohortRow` field order.
 *
 * Field-quoting rules:
 *   - Always quote string fields (defends against embedded `,` or `\n`).
 *   - Numbers are emitted unquoted.
 *   - `null` becomes an empty cell.
 *   - Embedded `"` is doubled to `""`.
 */
export function formatCsv(rows: ReadonlyArray<CohortRow>): string {
  const header = [
    "registrationId",
    "userId",
    "participantName",
    "participantEmail",
    "ticketTypeName",
    "status",
    "checkedInAt",
    "amountPaid",
    "refundedAmount",
    "npsBucket",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        quote(r.registrationId),
        quote(r.userId),
        quote(r.participantName),
        quote(r.participantEmail),
        quote(r.ticketTypeName),
        quote(r.status),
        quote(r.checkedInAt),
        String(r.amountPaid),
        String(r.refundedAmount),
        quote(r.npsBucket),
      ].join(","),
    );
  }
  // UTF-8 BOM (U+FEFF) prepended so Excel-FR opens the file correctly without
  // mangling the accents in participant names.
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

function quote(value: string | null): string {
  if (value === null || value === undefined) return "";
  return `"${value.replace(/"/g, '""')}"`;
}

export const cohortExportService = new CohortExportService();
