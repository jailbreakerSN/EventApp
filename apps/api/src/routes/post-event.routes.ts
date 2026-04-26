/**
 * Organizer overhaul — Phase O9.
 *
 * Post-event surface — JSON snapshot, PDF download, reconciliation
 * matrix, cohort CSV, payout request. Mounted under
 * `/v1/events/:eventId/post-event/*`.
 *
 * Permission split:
 *   - `event:read`            — JSON snapshot + PDF.
 *   - `payout:read`           — reconciliation matrix.
 *   - `registration:export`   — cohort CSV (PII).
 *   - `payout:create`         — payout request.
 *
 * The CSV endpoint streams the file as `text/csv; charset=utf-8` with
 * a `Content-Disposition` attachment header so the browser downloads
 * it directly. The PDF endpoint returns a JSON envelope with a signed
 * URL (Cloud Storage V4, 1h TTL) — same contract as receipts.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { postEventReportService } from "@/services/post-event-report.service";
import { reconciliationService } from "@/services/reconciliation.service";
import { cohortExportService } from "@/services/cohort-export.service";
import { postEventPdfService } from "@/services/post-event-pdf.service";
import { CohortSegmentSchema } from "@teranga/shared-types";

// `eventId` is interpolated into a `Content-Disposition` filename for
// the cohort CSV download. Constrain to alphanumeric + `_` + `-` so a
// malformed id can never inject `"` or `;` into the header value.
// Firestore auto-IDs already match this character set; the regex is
// pure defense in depth.
const EventIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const ParamsWithEventId = z.object({ eventId: EventIdSchema });
const CohortQuery = z.object({
  segment: CohortSegmentSchema.default("all"),
});

export const postEventRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── JSON snapshot (UI read model) ─────────────────────────────────
  fastify.get(
    "/:eventId/post-event/report",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["PostEvent"],
        summary: "Aggregated post-event snapshot (attendance + comms + finance)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await postEventReportService.getReport(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── Reconciliation matrix ─────────────────────────────────────────
  fastify.get(
    "/:eventId/post-event/reconciliation",
    {
      preHandler: [
        authenticate,
        requirePermission("payout:read"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["PostEvent"],
        summary: "Per-(method, status) reconciliation matrix for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await reconciliationService.getSummary(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── PDF download (signed URL) ─────────────────────────────────────
  fastify.get(
    "/:eventId/post-event/report.pdf",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["PostEvent"],
        summary: "Render + upload the post-event PDF and return a signed URL",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const result = await postEventPdfService.generatePdf(eventId, request.user!);
      return reply.send({
        success: true,
        data: { report: result.report, pdfURL: result.pdfURL },
      });
    },
  );

  // ─── Cohort CSV ────────────────────────────────────────────────────
  fastify.get(
    "/:eventId/post-event/cohort.csv",
    {
      preHandler: [
        authenticate,
        requirePermission("registration:export"),
        validate({ params: ParamsWithEventId, query: CohortQuery }),
      ],
      schema: {
        tags: ["PostEvent"],
        summary: "Download the cohort CSV (attended / no_show / cancelled / all)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { segment } = request.query as z.infer<typeof CohortQuery>;
      const result = await cohortExportService.exportCsv(eventId, segment, request.user!);
      const filename = `cohort-${segment}-${eventId}.csv`;
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(result.csv);
    },
  );

  // ─── Payout request ────────────────────────────────────────────────
  fastify.post(
    "/:eventId/post-event/payout-request",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("payout:create"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["PostEvent"],
        summary: "Organizer-initiated payout request for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const payout = await postEventReportService.requestPayout(eventId, request.user!);
      return reply.status(201).send({ success: true, data: payout });
    },
  );
};
