/**
 * Organizer overhaul — Phase O9.
 *
 * Server-side PDF rendering of the post-event report. Same `pdf-lib`
 * stack as the receipt + badge services — no native deps, no browser
 * round-trip, deterministic output.
 *
 * Layout (A4 portrait, single page):
 *
 *   ┌───────────────────────────────────────────┐
 *   │ TERANGA EVENTS — Rapport post-événement   │  ← navy header band
 *   ├───────────────────────────────────────────┤
 *   │ Event title                                │
 *   │ Period · Status                            │
 *   ├───────────────────────────────────────────┤
 *   │ Présence : registered / attended / no-show │
 *   ├───────────────────────────────────────────┤
 *   │ Communications : sent / dispatched / fail  │
 *   ├───────────────────────────────────────────┤
 *   │ Finances : gross / refund / fee / net      │
 *   ├───────────────────────────────────────────┤
 *   │ Top types de billets · Top zones           │
 *   ├───────────────────────────────────────────┤
 *   │ Footer : « généré le … par … »            │
 *   └───────────────────────────────────────────┘
 *
 * The PDF is uploaded to Cloud Storage at a deterministic path
 * (`reports/${eventId}/post-event.pdf`) so successive downloads
 * overwrite the previous render — there's only ever one canonical
 * post-event PDF per event. A V4 signed URL valid for 1 h is
 * returned, identical to the receipt service's pattern.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BaseService } from "./base.service";
import { storage } from "@/config/firebase";
import { postEventReportService } from "./post-event-report.service";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  AttendanceBreakdown,
  CommsPerformance,
  FinancialSummary,
  PostEventReport,
  BreakdownRow,
} from "@teranga/shared-types";

const A4 = { width: 595.28, height: 841.89 };
const NAVY = rgb(0.102, 0.102, 0.18);
const GOLD = rgb(0.773, 0.62, 0.294);
const MUTED = rgb(0.4, 0.4, 0.4);
const BORDER = rgb(0.87, 0.87, 0.87);
const BODY = rgb(0.12, 0.12, 0.12);

class PostEventPdfService extends BaseService {
  /**
   * Build the report (re-uses the read-model service, so the PDF
   * shows the SAME numbers the operator just saw on screen) and
   * upload the PDF.
   */
  async generatePdf(
    eventId: string,
    user: AuthUser,
  ): Promise<{ report: PostEventReport; pdfURL: string }> {
    // The underlying service handles permission + org-access checks
    // and emits `post_event_report.generated` once.
    const report = await postEventReportService.getReport(eventId, user);

    const pdfBytes = await renderReportPdf(report);
    const filePath = `reports/${eventId}/post-event.pdf`;
    const file = storage.bucket().file(filePath);

    await file.save(Buffer.from(pdfBytes), {
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, max-age=3600",
      },
    });

    const [pdfURL] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    // No second audit event — the inner `getReport()` already emitted
    // `post_event_report.generated` with the same payload. The PDF is
    // just a rendering of the same snapshot, so the single audit row
    // captures both the view and the download (cohort CSV remains a
    // distinct audit row because it ships PII rows).

    return { report, pdfURL };
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

/**
 * Render the report into a PDF. Pure (no Firestore, no upload) so
 * unit tests can assert on the byte output without booting the
 * storage bucket.
 */
export async function renderReportPdf(report: PostEventReport): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4.width, A4.height]);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { height } = page.getSize();
  let cursorY = height - 110;

  drawHeader(page, fontBold, fontRegular);
  drawTitleBlock(page, fontBold, fontRegular, report, cursorY);
  cursorY -= 80;

  cursorY = drawAttendanceCard(page, fontBold, fontRegular, report.attendance, cursorY);
  cursorY -= 12;
  cursorY = drawCommsCard(page, fontBold, fontRegular, report.comms, cursorY);
  cursorY -= 12;
  cursorY = drawFinancialCard(page, fontBold, fontRegular, report.financial, cursorY);
  cursorY -= 12;
  cursorY = drawBreakdowns(page, fontBold, fontRegular, report, cursorY);

  drawFooter(page, fontRegular, report);

  return pdfDoc.save();
}

function drawHeader(page: PDFPage, fontBold: PDFFont, fontRegular: PDFFont): void {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: NAVY });
  page.drawText("TERANGA EVENTS", {
    x: 40,
    y: height - 45,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText("RAPPORT POST-ÉVÉNEMENT", {
    x: 40,
    y: height - 65,
    size: 9,
    font: fontRegular,
    color: GOLD,
  });
}

function drawTitleBlock(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  report: PostEventReport,
  startY: number,
): void {
  page.drawText(report.eventTitle.slice(0, 80), {
    x: 40,
    y: startY,
    size: 16,
    font: fontBold,
    color: NAVY,
  });
  const period = formatPeriod(report.eventStartDate, report.eventEndDate);
  const status = report.isFinal ? "Événement clos" : "Événement en cours";
  page.drawText(`${period} · ${status}`, {
    x: 40,
    y: startY - 18,
    size: 9,
    font: fontRegular,
    color: MUTED,
  });
}

function drawAttendanceCard(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  attendance: AttendanceBreakdown,
  startY: number,
): number {
  return drawCard(page, fontBold, fontRegular, "Présence", startY, [
    [`Inscrits`, String(attendance.registered)],
    [`Présents`, `${attendance.checkedIn} (${attendance.checkinRatePercent}%)`],
    [`No-show`, String(attendance.noShow)],
    [`Annulations`, String(attendance.cancelled)],
  ]);
}

function drawCommsCard(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  comms: CommsPerformance,
  startY: number,
): number {
  const channels = comms.perChannel
    .slice(0, 4)
    .map((c) => `${c.label}: ${c.count}`)
    .join("  ·  ");
  return drawCard(page, fontBold, fontRegular, "Communications", startY, [
    ["Diffusions envoyées", String(comms.broadcastsSent)],
    ["Destinataires", String(comms.totalRecipients)],
    ["Messages dispatchés", String(comms.totalDispatched)],
    ["Échecs", String(comms.totalFailed)],
    ["Par canal", channels || "—"],
  ]);
}

function drawFinancialCard(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  financial: FinancialSummary,
  startY: number,
): number {
  // pdf-lib's WinAnsi encoding rejects the narrow-no-break-space
  // (U+202F) that modern Node emits in `toLocaleString("fr-FR")`. We
  // pass the result through `sanitizeForWinAnsi` so the renderer is
  // robust to whichever Node version produces which whitespace char.
  const fmt = (n: number) =>
    `${sanitizeForWinAnsi(n.toLocaleString("fr-FR"))} ${financial.currency}`;
  return drawCard(page, fontBold, fontRegular, "Finances", startY, [
    ["Montant brut", fmt(financial.grossAmount)],
    ["Remboursements", fmt(financial.refundedAmount)],
    ["Frais plateforme", fmt(financial.platformFee)],
    ["Net à verser", fmt(financial.payoutAmount)],
    ["Inscriptions payantes", String(financial.paidRegistrations)],
  ]);
}

function drawBreakdowns(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  report: PostEventReport,
  startY: number,
): number {
  const ticketTop = report.demographics.byTicketType.slice(0, 5);
  const zoneTop = report.demographics.byAccessZone.slice(0, 5);

  // Two side-by-side mini-tables. Width 235 each, gutter 25.
  let y = startY;
  page.drawText("Top types de billets", {
    x: 40,
    y,
    size: 9,
    font: fontBold,
    color: NAVY,
  });
  page.drawText("Top zones d'accès", {
    x: 40 + 235 + 25,
    y,
    size: 9,
    font: fontBold,
    color: NAVY,
  });
  y -= 14;

  y = drawBreakdownColumn(page, fontRegular, ticketTop, 40, y) > 0 ? y : y;
  drawBreakdownColumn(page, fontRegular, zoneTop, 40 + 235 + 25, startY - 14);

  // Return the lowest of the two columns so the next card starts below
  // the longest one. They'll usually be the same length anyway.
  const rowsCount = Math.max(ticketTop.length, zoneTop.length);
  return startY - 14 - rowsCount * 14;
}

function drawBreakdownColumn(
  page: PDFPage,
  fontRegular: PDFFont,
  rows: ReadonlyArray<BreakdownRow>,
  x: number,
  startY: number,
): number {
  if (rows.length === 0) {
    page.drawText("—", { x, y: startY, size: 9, font: fontRegular, color: MUTED });
    return startY - 14;
  }
  let y = startY;
  for (const r of rows) {
    page.drawText(r.label.slice(0, 30), {
      x,
      y,
      size: 9,
      font: fontRegular,
      color: BODY,
    });
    page.drawText(String(r.count), {
      x: x + 200,
      y,
      size: 9,
      font: fontRegular,
      color: MUTED,
    });
    y -= 14;
  }
  return y;
}

function drawCard(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  title: string,
  startY: number,
  rows: ReadonlyArray<[string, string]>,
): number {
  const { width } = page.getSize();
  const innerHeight = 18 + rows.length * 16 + 12;
  page.drawRectangle({
    x: 40,
    y: startY - innerHeight,
    width: width - 80,
    height: innerHeight,
    borderColor: BORDER,
    borderWidth: 0.5,
  });
  page.drawText(title.toUpperCase(), {
    x: 50,
    y: startY - 14,
    size: 8,
    font: fontBold,
    color: GOLD,
  });
  let y = startY - 30;
  for (const [k, v] of rows) {
    page.drawText(k, {
      x: 50,
      y,
      size: 9,
      font: fontRegular,
      color: MUTED,
    });
    page.drawText(v, {
      x: width - 220,
      y,
      size: 9,
      font: fontBold,
      color: BODY,
    });
    y -= 16;
  }
  return startY - innerHeight;
}

function drawFooter(page: PDFPage, fontRegular: PDFFont, report: PostEventReport): void {
  const { width } = page.getSize();
  const stamp = sanitizeForWinAnsi(
    new Date(report.computedAt).toLocaleString("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    }),
  );
  page.drawText(`Généré le ${stamp}`, {
    x: 40,
    y: 40,
    size: 7,
    font: fontRegular,
    color: MUTED,
  });
  page.drawText("Teranga Events · teranga.events", {
    x: width - 200,
    y: 40,
    size: 7,
    font: fontRegular,
    color: MUTED,
  });
}

function formatPeriod(start: string, end: string | null): string {
  const s = new Date(start);
  if (!end) {
    return sanitizeForWinAnsi(s.toLocaleDateString("fr-FR", { dateStyle: "long" }));
  }
  const e = new Date(end);
  if (s.toDateString() === e.toDateString()) {
    return sanitizeForWinAnsi(s.toLocaleDateString("fr-FR", { dateStyle: "long" }));
  }
  return sanitizeForWinAnsi(`${s.toLocaleDateString("fr-FR")} -> ${e.toLocaleDateString("fr-FR")}`);
}

/**
 * Replace characters pdf-lib's WinAnsi encoder can't render.
 *  - U+202F (narrow no-break space, used by Intl in fr-FR thousands).
 *  - U+00A0 (regular no-break space).
 *  - U+2009 (thin space).
 * All map to a regular space so the layout stays close to the
 * original rendering. Other multi-byte chars (em-dash, accents) are
 * fine — WinAnsi covers them.
 */
function sanitizeForWinAnsi(input: string): string {
  return input.replace(/[\u00a0\u2009\u202f]/g, " ");
}

export const postEventPdfService = new PostEventPdfService();
