import {
  type GeneratedBadge,
  type OfflineEventData,
  type Registration,
} from "@teranga/shared-types";
import { type DocumentSnapshot, FieldValue } from "firebase-admin/firestore";
import { db, storage, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { NotFoundError, ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export interface BadgePdfResult {
  buffer: Buffer;
  filename: string;
}

// ─── Rendering helpers ─────────────────────────────────────────────────────

/**
 * Greedy word-wrap to a max pixel width, capped at `maxLines`. The last line
 * gets an ellipsis if the text was truncated. pdf-lib doesn't ship a text
 * layout engine, so this does the minimum needed for the event title.
 */
function wrapText(
  text: string,
  font: { widthOfTextAtSize: (s: string, size: number) => number },
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // If we still overflow (single unbreakable word > maxWidth, or ran out of
  // lines), truncate the last line with an ellipsis so we never exceed
  // maxLines and never spill past maxWidth.
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) {
      last = last.slice(0, -1);
    }
    if (font.widthOfTextAtSize(text, size) > maxWidth * maxLines) {
      lines[maxLines - 1] = `${last.trimEnd()}…`;
    }
  }
  return lines;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class BadgeService extends BaseService {
  private get badgesCollection() {
    return db.collection(COLLECTIONS.BADGES);
  }

  private get templatesCollection() {
    return db.collection(COLLECTIONS.BADGE_TEMPLATES);
  }

  /**
   * Trigger badge generation for a single registration.
   * Creates a badge document in Firestore — the Cloud Function trigger
   * generates the actual PDF asynchronously.
   */
  async generate(
    registrationId: string,
    templateId: string,
    user: AuthUser,
  ): Promise<GeneratedBadge> {
    this.requirePermission(user, "badge:generate");

    const registration = await registrationRepository.findByIdOrThrow(registrationId);

    if (registration.status !== "confirmed" && registration.status !== "checked_in") {
      throw new ValidationError(
        "Le badge ne peut être généré que pour les inscriptions confirmées",
      );
    }

    // Verify template exists
    const templateDoc = await this.templatesCollection.doc(templateId).get();
    if (!templateDoc.exists) {
      throw new NotFoundError("BadgeTemplate", templateId);
    }

    // Verify user has access to the event's organization
    const event = await eventRepository.findByIdOrThrow(registration.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Deterministic doc id — same shape every badge writer now uses. The
    // read-then-write is wrapped in a transaction to avoid the race where
    // two concurrent `generate()` calls (organizer + cloud trigger firing
    // on the same registration confirmation) both pass an "exists?" check
    // and both write. Fast path: outer existence check returns without
    // opening a transaction when the badge is already present.
    const docId = `${registration.eventId}_${registration.userId}`;
    const docRef = this.badgesCollection.doc(docId);
    const existing = await docRef.get();
    if (existing.exists) {
      return { id: existing.id, ...existing.data() } as GeneratedBadge;
    }

    const now = new Date().toISOString();
    const badge: GeneratedBadge = {
      id: docId,
      registrationId,
      eventId: registration.eventId,
      userId: registration.userId,
      templateId,
      status: "pending",
      pdfURL: null,
      qrCodeValue: registration.qrCodeValue,
      error: null,
      generatedAt: now,
      downloadCount: 0,
    };

    const created = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docRef);
      if (fresh.exists) {
        return { id: fresh.id, ...fresh.data() } as GeneratedBadge;
      }
      tx.set(docRef, badge);
      return badge;
    });

    // Only emit the audit event when we actually wrote a new doc. Comparing
    // `generatedAt` keeps the check allocation-free vs. tagging the result
    // with a separate `didCreate` field.
    if (created.generatedAt === now) {
      eventBus.emit("badge.generated", {
        badgeId: created.id,
        registrationId,
        eventId: registration.eventId,
        organizationId: event.organizationId,
        userId: registration.userId,
        actorId: user.uid,
        requestId: getRequestId(),
        timestamp: now,
      });
    }

    return created;
  }

  /**
   * Bulk generate badges for all confirmed registrations of an event.
   * Uses cursor-based pagination to avoid loading all registrations into memory.
   */
  async bulkGenerate(
    eventId: string,
    templateId: string,
    user: AuthUser,
  ): Promise<{ queued: number }> {
    this.requirePermission(user, "badge:bulk_generate");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const templateDoc = await this.templatesCollection.doc(templateId).get();
    if (!templateDoc.exists) {
      throw new NotFoundError("BadgeTemplate", templateId);
    }

    // Discover which (eventId, userId) pairs already have a badge. We key
    // by userId rather than registrationId because the deterministic doc
    // id is `${eventId}_${userId}` — that's the single source of truth
    // every writer agrees on, so checking by registrationId would miss
    // badges created before this registration flipped to confirmed.
    const existingBadgesSnap = await this.badgesCollection.where("eventId", "==", eventId).get();
    const existingUserIds = new Set(existingBadgesSnap.docs.map((d) => d.data().userId as string));

    const CHUNK_SIZE = 500;
    let queued = 0;
    let lastDoc: DocumentSnapshot | null = null;
    const now = new Date().toISOString();

    // Process registrations in chunks via cursor pagination
    let hasMore = true;
    while (hasMore) {
      const page = await registrationRepository.findByEventCursor(
        eventId,
        ["confirmed", "checked_in"],
        CHUNK_SIZE,
        lastDoc ?? undefined,
      );

      if (page.data.length === 0) break;
      lastDoc = page.lastDoc;
      hasMore = page.data.length === CHUNK_SIZE;

      // Filter out registrations that already have badges, and also dedupe
      // within this page so two registrations for the same user (shouldn't
      // happen in prod, but defensive) don't collide in the same batch.
      const seenThisPage = new Set<string>();
      const toCreate = page.data.filter((reg) => {
        if (existingUserIds.has(reg.userId)) return false;
        if (seenThisPage.has(reg.userId)) return false;
        seenThisPage.add(reg.userId);
        return true;
      });
      if (toCreate.length === 0) continue;

      // Per-item `docRef.create()` instead of `batch.set()` — the former
      // is an atomic create-if-missing that throws ALREADY_EXISTS on
      // conflict, so a concurrent `getMyBadge` / `generate` / trigger
      // that wins the race between our `existingUserIds` snapshot and
      // this write cannot be overwritten (batched `set` without merge
      // would silently clobber any `pdfURL` / `status: "generated"` the
      // winning writer had already landed — caught by the transaction
      // auditor).
      //
      // `Promise.allSettled` runs creates in parallel per chunk (≤500
      // RPCs); rejections from ALREADY_EXISTS are a no-op for the
      // queued counter since the badge is already there. Any other
      // rejection rethrows so the organizer sees a real error.
      const results = await Promise.allSettled(
        toCreate.map(async (reg) => {
          const badgeId = `${eventId}_${reg.userId}`;
          await this.badgesCollection.doc(badgeId).create({
            id: badgeId,
            registrationId: reg.id,
            eventId,
            userId: reg.userId,
            templateId,
            status: "pending",
            pdfURL: null,
            qrCodeValue: reg.qrCodeValue,
            error: null,
            generatedAt: now,
            downloadCount: 0,
          });
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          queued++;
          continue;
        }
        // gRPC ALREADY_EXISTS = code 6. Silently skip — another writer
        // landed the badge first, which is exactly the invariant we
        // wanted to preserve.
        const code = (r.reason as { code?: number })?.code;
        if (code === 6) continue;
        throw r.reason;
      }
    }

    // Aggregate audit event — the number of badges created in this call
    // (zero counts if the caller was re-running and every user already
    // had one). Per-badge emission would flood the trail without adding
    // signal; `badge.bulk_generated` mirrors `checkin.bulk_synced`.
    if (queued > 0) {
      eventBus.emit("badge.bulk_generated", {
        eventId,
        organizationId: event.organizationId,
        templateId: templateId || null,
        created: queued,
        actorId: user.uid,
        requestId: getRequestId(),
        timestamp: new Date().toISOString(),
      });
    }

    return { queued };
  }

  /**
   * Get a user's own badge metadata for an event.
   *
   * The PDF is rendered on demand by `getMyBadgePdf` and streamed back through
   * the API — we no longer upload to Cloud Storage or generate signed URLs
   * here. Cloud Run's runtime service account lacks `iam.signBlob` by default,
   * so the V4 signed URL path failed in production with a 500. Streaming the
   * bytes directly removes that IAM dependency entirely and keeps the PDF
   * behind authentication.
   */
  async getMyBadge(eventId: string, user: AuthUser): Promise<GeneratedBadge> {
    this.requirePermission(user, "badge:view_own");

    // Deterministic doc ID + transaction kills the race where two concurrent
    // first-time fetches would both pass the "empty" check and create two
    // badge documents for the same (event, user) pair. Per CLAUDE.md any
    // read-then-write must be transactional.
    const docId = `${eventId}_${user.uid}`;
    const docRef = this.badgesCollection.doc(docId);

    const existing = await docRef.get();
    if (existing.exists) {
      return { id: existing.id, ...existing.data() } as GeneratedBadge;
    }

    const registration = await this.findUserRegistration(eventId, user.uid);
    if (!registration) {
      throw new NotFoundError("Registration");
    }
    if (registration.status !== "confirmed" && registration.status !== "checked_in") {
      throw new ValidationError("Le badge n'est disponible que pour les inscriptions confirmées");
    }

    const now = new Date().toISOString();
    const badge: GeneratedBadge = {
      id: docId,
      registrationId: registration.id,
      eventId,
      userId: user.uid,
      templateId: "",
      status: "generated",
      pdfURL: null,
      qrCodeValue: registration.qrCodeValue,
      error: null,
      generatedAt: now,
      downloadCount: 0,
    };

    const created = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docRef);
      if (fresh.exists) {
        return { id: fresh.id, ...fresh.data() } as GeneratedBadge;
      }
      tx.set(docRef, badge);
      return badge;
    });

    // Only emit the audit event when we actually wrote a new doc — comparing
    // `generatedAt` is the cheapest way to detect "we lost the race and the
    // other writer won" without a second read.
    if (created.generatedAt === now) {
      // One extra event read on the winning path to stamp
      // `auditLogs.organizationId`. Cross-org queries on
      // `badge.generated` were blind before; accept the lookup cost on
      // the first-time-ever fetch (subsequent calls short-circuit at
      // line 298 without emitting).
      const eventDoc = await eventRepository.findById(eventId).catch(() => null);
      eventBus.emit("badge.generated", {
        badgeId: created.id,
        registrationId: created.registrationId,
        eventId: created.eventId,
        organizationId: eventDoc?.organizationId ?? "",
        userId: created.userId,
        actorId: user.uid,
        requestId: getRequestId(),
        timestamp: now,
      });
    }

    return created;
  }

  /**
   * Render a user's badge PDF on demand and return raw bytes for streaming.
   *
   * Used by the route handler to set Content-Type/Content-Disposition and
   * pipe the buffer back to the client. Always renders fresh from the
   * registration — there is no persistent PDF file to keep in sync.
   */
  async getMyBadgePdf(eventId: string, user: AuthUser): Promise<BadgePdfResult> {
    this.requirePermission(user, "badge:view_own");

    const registration = await this.findUserRegistration(eventId, user.uid);
    if (!registration) {
      throw new NotFoundError("Registration");
    }
    if (registration.status !== "confirmed" && registration.status !== "checked_in") {
      throw new ValidationError("Le badge n'est disponible que pour les inscriptions confirmées");
    }

    const buffer = await this.renderBadgePdf(registration, eventId);
    return { buffer, filename: `badge-${eventId}.pdf` };
  }

  /**
   * Stream a previously-generated badge PDF (organizer/staff download).
   *
   * Reads the file from Cloud Storage and returns the bytes — no signed URL
   * required, so the route works on Cloud Run without `iam.signBlob`.
   * Increments the download counter fire-and-forget.
   */
  async download(badgeId: string, user: AuthUser): Promise<BadgePdfResult> {
    const snap = await this.badgesCollection.doc(badgeId).get();
    if (!snap.exists) throw new NotFoundError("Badge", badgeId);

    const badge = { id: snap.id, ...snap.data() } as GeneratedBadge;

    if (badge.userId !== user.uid) {
      this.requirePermission(user, "badge:generate");
      const event = await eventRepository.findByIdOrThrow(badge.eventId);
      this.requireOrganizationAccess(user, event.organizationId);
    }

    if (badge.status === "failed") {
      throw new ValidationError(`Badge generation failed: ${badge.error ?? "unknown error"}`);
    }

    let buffer: Buffer;
    if (badge.pdfURL) {
      const storagePath = `badges/${badge.eventId}/${badge.userId}/${badge.id}.pdf`;
      const file = storage.bucket().file(storagePath);
      const [bytes] = await file.download();
      buffer = bytes;
    } else {
      const registration = await registrationRepository.findByIdOrThrow(badge.registrationId);
      buffer = await this.renderBadgePdf(registration, badge.eventId);
    }

    // Atomic increment — Firestore handles concurrent download counts on
    // the server side, so we don't need a transaction or to read the
    // current value first.
    const reqId = getRequestId();
    this.badgesCollection
      .doc(badgeId)
      .update({ downloadCount: FieldValue.increment(1) })
      .catch((err: unknown) => {
        process.stderr.write(
          `[BadgeService] reqId=${reqId} Failed to increment download counter for badge ${badgeId}: ${err}\n`,
        );
      });

    return { buffer, filename: `badge-${badge.eventId}.pdf` };
  }

  /**
   * Find a user's active registration for an event.
   */
  private async findUserRegistration(
    eventId: string,
    userId: string,
  ): Promise<Registration | null> {
    const regSnap = await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .where("eventId", "==", eventId)
      .where("userId", "==", userId)
      .where("status", "in", ["confirmed", "checked_in", "pending", "waitlisted"])
      .limit(1)
      .get();

    if (regSnap.empty) return null;
    return { id: regSnap.docs[0].id, ...regSnap.docs[0].data() } as Registration;
  }

  /**
   * Render the badge PDF in-memory and return raw bytes.
   *
   * Pure rendering — no Firestore writes, no Cloud Storage upload, no
   * signed-URL generation. Mirrors the on-screen `TicketPass` editorial
   * treatment: green header with serif event title and three fields, dashed
   * perforation with notches, navy body with white QR panel, gold "ACCÈS
   * VALIDE" pill, and an offline hint strip at the bottom.
   *
   * Page size is A6 portrait (105 × 148 mm) — a standard paper format that
   * prints cleanly on A4 (4-up) and fits most lanyard pouches when trimmed.
   */
  private async renderBadgePdf(registration: Registration, eventId: string): Promise<Buffer> {
    const [event, userData] = await Promise.all([
      eventRepository.findByIdOrThrow(eventId),
      userRepository.findById(registration.userId),
    ]);

    const participantName = userData?.displayName ?? "Participant";
    const ticketType = event.ticketTypes.find((t) => t.id === registration.ticketTypeId);
    const ticketName = ticketType?.name ?? "Participant";

    // Brand palette (packages/shared-config/tailwind.config.ts). Kept inline
    // so the PDF stays self-contained and doesn't need to parse CSS tokens.
    const hex = (h: string) => {
      const r = parseInt(h.slice(1, 3), 16) / 255;
      const g = parseInt(h.slice(3, 5), 16) / 255;
      const b = parseInt(h.slice(5, 7), 16) / 255;
      return rgb(r, g, b);
    };
    const navy = hex("#1A1A2E");
    const navyDeep = hex("#0F0F1C");
    const forest = hex("#2a473c");
    const gold = hex("#c59e4b");
    const goldLight = hex("#d1b372");
    const white = rgb(1, 1, 1);
    const mutedWhite = rgb(0.78, 0.78, 0.84);
    const dimWhite = rgb(0.6, 0.6, 0.66);

    const qrPngBase64 = await QRCode.toDataURL(registration.qrCodeValue, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 600,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    const qrImageBytes = Buffer.from(qrPngBase64.split(",")[1], "base64");

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Badge — ${event.title}`);
    pdfDoc.setAuthor("Teranga Events");
    pdfDoc.setSubject(`Pass nominatif · ${participantName}`);
    pdfDoc.setCreator("Teranga API");

    // A6 portrait — 105 × 148 mm. Helper converts mm to PDF points once.
    const mm = (v: number) => v * 2.83465;
    const W_MM = 105;
    const H_MM = 148;
    const page = pdfDoc.addPage([mm(W_MM), mm(H_MM)]);
    const W = page.getWidth();
    const H = page.getHeight();

    const fontSerif = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);

    // ─── Backdrop ──────────────────────────────────────────────────────────
    // Navy body fills the whole page first; the header band paints over the
    // top half. Using a slightly darker navy at the bottom gives a subtle
    // vertical gradient feel without the complexity of real gradients.
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: navy });
    page.drawRectangle({ x: 0, y: 0, width: W, height: mm(28), color: navyDeep });

    // ─── Header band ───────────────────────────────────────────────────────
    // Solid forest green (the "Teranga green" from the logo palette). Using
    // a deeper stripe at the top edge reads as a subtle gradient in print.
    const HEADER_MM = 52;
    const headerBottomMm = H_MM - HEADER_MM;
    page.drawRectangle({
      x: 0,
      y: mm(headerBottomMm),
      width: W,
      height: mm(HEADER_MM),
      color: forest,
    });
    page.drawRectangle({
      x: 0,
      y: mm(H_MM - 6),
      width: W,
      height: mm(6),
      color: hex("#223b31"),
    });

    // Kicker — uppercase, tracked, in muted white.
    const kicker = "TERANGA  ·  PASS NOMINATIF";
    page.drawText(kicker, {
      x: mm(10),
      y: mm(H_MM - 13),
      size: 7.5,
      font: fontBold,
      color: rgb(1, 1, 1),
      opacity: 0.9,
    });

    // Event title — serif display, wrapped to 2 lines if the title is long.
    // Caps width at ~82mm (padding 10mm on each side + small breathing room).
    const titleSize = 22;
    const titleMaxWidthPt = mm(85);
    const titleLines = wrapText(event.title ?? "Event", fontSerif, titleSize, titleMaxWidthPt, 2);
    let titleY = mm(H_MM - 20);
    for (const line of titleLines) {
      page.drawText(line, {
        x: mm(10),
        y: titleY,
        size: titleSize,
        font: fontSerif,
        color: white,
      });
      titleY -= titleSize + 2;
    }

    // Three fields row under the title — DATE, PASS, LIEU.
    const eventDate = new Date(registration.createdAt);
    const dateValue = eventDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const holderFirstName = participantName.split(" ")[0] || participantName;
    const fields: Array<{ label: string; value: string }> = [
      { label: "DATE", value: dateValue },
      { label: "PASS", value: truncate(ticketName, 18) },
      { label: "LIEU", value: truncate(holderFirstName, 14) },
    ];

    const fieldsY = mm(headerBottomMm + 8);
    let colX = mm(10);
    const colGap = mm(5);
    for (const f of fields) {
      page.drawText(f.label, {
        x: colX,
        y: fieldsY + 11,
        size: 7,
        font: fontBold,
        color: rgb(1, 1, 1),
        opacity: 0.7,
      });
      page.drawText(f.value, {
        x: colX,
        y: fieldsY,
        size: 10,
        font: fontBold,
        color: white,
      });
      const valueWidth = fontBold.widthOfTextAtSize(f.value, 10);
      const labelWidth = fontBold.widthOfTextAtSize(f.label, 7);
      colX += Math.max(valueWidth, labelWidth) + colGap;
    }

    // ─── Perforation line + notches ────────────────────────────────────────
    // Dashed line across the full width at the band seam, plus two small
    // disc notches at the edges (background colour) to mimic the ticket
    // "tear here" UI affordance.
    const perfY = mm(headerBottomMm);
    page.drawLine({
      start: { x: mm(4), y: perfY },
      end: { x: W - mm(4), y: perfY },
      thickness: 0.6,
      color: white,
      opacity: 0.35,
      dashArray: [2.5, 2],
    });
    page.drawCircle({ x: 0, y: perfY, size: 3, color: navy });
    page.drawCircle({ x: W, y: perfY, size: 3, color: navy });

    // ─── QR panel ──────────────────────────────────────────────────────────
    // White square with a subtle gold hairline. Centered horizontally; the
    // vertical position keeps ~36 mm clear below for code + holder + pill +
    // helper + divider + offline footer.
    const qrPanelSizeMm = 50;
    const qrPaddingMm = 3.5;
    const qrPanelX = (W - mm(qrPanelSizeMm)) / 2;
    const qrPanelY = mm(headerBottomMm - qrPanelSizeMm - 10);

    page.drawRectangle({
      x: qrPanelX - 1,
      y: qrPanelY - 1,
      width: mm(qrPanelSizeMm) + 2,
      height: mm(qrPanelSizeMm) + 2,
      color: gold,
      opacity: 0.35,
    });
    page.drawRectangle({
      x: qrPanelX,
      y: qrPanelY,
      width: mm(qrPanelSizeMm),
      height: mm(qrPanelSizeMm),
      color: white,
    });

    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    const qrSize = mm(qrPanelSizeMm - qrPaddingMm * 2);
    page.drawImage(qrImage, {
      x: qrPanelX + mm(qrPaddingMm),
      y: qrPanelY + mm(qrPaddingMm),
      width: qrSize,
      height: qrSize,
    });

    // ─── Code value (monospace, truncated) ────────────────────────────────
    const codeValue = registration.qrCodeValue.slice(0, 24);
    const codeSize = 8.5;
    const codeWidth = fontMono.widthOfTextAtSize(codeValue, codeSize);
    page.drawText(codeValue, {
      x: (W - codeWidth) / 2,
      y: mm(30),
      size: codeSize,
      font: fontMono,
      color: mutedWhite,
    });

    // ─── Holder line: "Name · Ticket type" ────────────────────────────────
    const holder = `${participantName}  ·  ${ticketName}`;
    const holderSize = 10;
    const holderWidth = fontBold.widthOfTextAtSize(holder, holderSize);
    page.drawText(holder, {
      x: (W - holderWidth) / 2,
      y: mm(24),
      size: holderSize,
      font: fontBold,
      color: white,
    });

    // ─── Gold pill: "ACCÈS VALIDE" ────────────────────────────────────────
    const pillText = "ACCÈS VALIDE";
    const pillSize = 8;
    const pillTextWidth = fontBold.widthOfTextAtSize(pillText, pillSize);
    const pillPaddingX = mm(4);
    const pillPaddingY = 4;
    const pillW = pillTextWidth + pillPaddingX * 2;
    const pillH = pillSize + pillPaddingY * 2;
    const pillX = (W - pillW) / 2;
    const pillY = mm(15);

    // Fake "rounded" pill — stack the main rect with two half-discs at the
    // ends. pdf-lib has no native corner radius for rectangles.
    const pillRadius = pillH / 2;
    page.drawRectangle({
      x: pillX + pillRadius,
      y: pillY,
      width: pillW - pillRadius * 2,
      height: pillH,
      color: gold,
    });
    page.drawCircle({
      x: pillX + pillRadius,
      y: pillY + pillRadius,
      size: pillRadius,
      color: gold,
    });
    page.drawCircle({
      x: pillX + pillW - pillRadius,
      y: pillY + pillRadius,
      size: pillRadius,
      color: gold,
    });
    page.drawText(pillText, {
      x: pillX + pillPaddingX,
      y: pillY + pillPaddingY + 0.5,
      size: pillSize,
      font: fontBold,
      color: navy,
    });

    // ─── Helper text ──────────────────────────────────────────────────────
    const helper = "Présentez ce QR code à l'entrée de l'événement.";
    const helperSize = 7.5;
    const helperWidth = fontRegular.widthOfTextAtSize(helper, helperSize);
    page.drawText(helper, {
      x: (W - helperWidth) / 2,
      y: mm(10),
      size: helperSize,
      font: fontRegular,
      color: dimWhite,
    });

    // ─── Divider separating the ticket body from the offline footer ──────
    page.drawLine({
      start: { x: mm(12), y: mm(6.5) },
      end: { x: W - mm(12), y: mm(6.5) },
      thickness: 0.3,
      color: white,
      opacity: 0.12,
    });

    // ─── Footer offline strip ─────────────────────────────────────────────
    // Standard PDF fonts are WinAnsi-only (no ⚡ emoji), so the lightning
    // glyph is drawn as a small gold SVG path next to the text.
    const footerY = mm(2.5);
    const offlineText = "Disponible hors ligne";
    const offlineSize = 7;
    const offlineWidth = fontBold.widthOfTextAtSize(offlineText, offlineSize);
    const boltWidth = 3;
    const gap = 3;
    const offlineBlockWidth = boltWidth + gap + offlineWidth;
    const offlineX = (W - offlineBlockWidth) / 2;

    // Lightning bolt — tiny chevron-ish filled path. SVG y grows down; the
    // pdf-lib `y` anchor flips the coordinate so the glyph sits on the
    // footer baseline. Scale 0.9 keeps the icon optically balanced with
    // the 7pt label next to it.
    page.drawSvgPath("M 2 0 L 0 3 L 1.2 3 L 0.4 5 L 2.6 2 L 1.4 2 Z", {
      x: offlineX,
      y: footerY + 5,
      color: goldLight,
      scale: 0.9,
    });
    page.drawText(offlineText, {
      x: offlineX + boltWidth + gap,
      y: footerY,
      size: offlineSize,
      font: fontBold,
      color: goldLight,
      opacity: 0.85,
    });

    return Buffer.from(await pdfDoc.save());
  }

  /**
   * Build offline sync payload for staff QR scanning.
   * Uses cursor-based pagination to avoid loading all registrations at once.
   * Safety cap at 20,000 registrations to prevent OOM on very large events.
   */
  async getOfflineSyncData(eventId: string, user: AuthUser): Promise<OfflineEventData> {
    this.requirePermission(user, "checkin:sync_offline");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const CHUNK_SIZE = 1000;
    const MAX_REGISTRATIONS = 20_000;
    const allRegistrations: Registration[] = [];
    let lastDoc: DocumentSnapshot | null = null;

    // Fetch registrations in chunks via cursor pagination
    let hasMore = true;
    while (hasMore && allRegistrations.length < MAX_REGISTRATIONS) {
      const page = await registrationRepository.findByEventCursor(
        eventId,
        ["confirmed", "waitlisted", "checked_in"],
        CHUNK_SIZE,
        lastDoc ?? undefined,
      );

      allRegistrations.push(...page.data);
      lastDoc = page.lastDoc;
      hasMore = page.data.length === CHUNK_SIZE;
    }

    // Batch-fetch participant names in chunks (batchGet internally handles 100-doc limit)
    const userIds = allRegistrations.map((r) => r.userId);
    const users = await userRepository.batchGet(userIds);
    const userMap = new Map(users.map((u) => [u.uid, u]));

    // TTL hint — staff devices purge the cached payload at `event.endDate + 24h`.
    const ttlAt = new Date(new Date(event.endDate).getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
      eventId,
      downloadedAt: new Date().toISOString(),
      ttlAt,
      registrations: allRegistrations.map((reg) => {
        const participant = userMap.get(reg.userId);
        const ticketType = event.ticketTypes.find((t) => t.id === reg.ticketTypeId);
        return {
          qrCodeValue: reg.qrCodeValue,
          registrationId: reg.id,
          participantName: participant?.displayName ?? "Unknown",
          ticketTypeId: reg.ticketTypeId,
          ticketTypeName: ticketType?.name ?? "Unknown",
          accessZoneIds: ticketType?.accessZoneIds ?? [],
          status:
            reg.status === "checked_in"
              ? ("confirmed" as const)
              : (reg.status as "confirmed" | "waitlisted"),
          checkedIn: reg.status === "checked_in",
          checkedInAt: reg.checkedInAt ?? null,
        };
      }),
    };
  }
}

export const badgeService = new BadgeService();
