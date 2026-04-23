import { type Receipt, isAdminSystemRole } from "@teranga/shared-types";
import { receiptRepository } from "@/repositories/receipt.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { storage } from "@/config/firebase";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export class ReceiptService extends BaseService {
  /**
   * Generate a receipt for a succeeded payment.
   */
  async generateReceipt(paymentId: string, user: AuthUser): Promise<Receipt> {
    this.requirePermission(user, "payment:read_own");

    const payment = await paymentRepository.findByIdOrThrow(paymentId);

    // Only the payment owner, a platform admin, or an organizer with
    // payment:read_all inside the owning org can generate a receipt.
    if (payment.userId !== user.uid && !user.roles.some(isAdminSystemRole)) {
      this.requirePermission(user, "payment:read_all");
      this.requireOrganizationAccess(user, payment.organizationId);
    }

    if (payment.status !== "succeeded") {
      throw new ValidationError("Un reçu ne peut être généré que pour un paiement confirmé");
    }

    // Check if receipt already exists
    const existing = await receiptRepository.findByPayment(paymentId);
    if (existing) return existing;

    // Fetch related data for denormalization
    const [event, userDoc] = await Promise.all([
      eventRepository.findByIdOrThrow(payment.eventId),
      userRepository.findById(payment.userId),
    ]);

    let organizationName = "Teranga";
    try {
      const org = await organizationRepository.findByIdOrThrow(payment.organizationId);
      organizationName = org.name;
    } catch {
      // fallback to default
    }

    const ticketType = event.ticketTypes.find((t) => t.name);
    const now = new Date().toISOString();
    const receiptNumber = await receiptRepository.generateReceiptNumber();

    const receipt: Receipt = {
      id: "", // will be set by create
      receiptNumber,
      paymentId: payment.id,
      registrationId: payment.registrationId,
      eventId: payment.eventId,
      organizationId: payment.organizationId,
      userId: payment.userId,
      amount: payment.amount,
      currency: "XOF",
      method: payment.method,
      eventTitle: event.title,
      ticketTypeName: ticketType?.name ?? "Billet",
      participantName: userDoc?.displayName ?? "Participant",
      participantEmail: userDoc?.email ?? null,
      organizationName,
      issuedAt: now,
      createdAt: now,
    };

    const created = await receiptRepository.create(receipt);

    eventBus.emit("receipt.generated", {
      receiptId: created.id,
      paymentId: payment.id,
      eventId: payment.eventId,
      organizationId: payment.organizationId,
      userId: payment.userId,
      amount: payment.amount,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return created;
  }

  /**
   * Get a receipt by ID.
   */
  async getReceipt(receiptId: string, user: AuthUser): Promise<Receipt> {
    this.requirePermission(user, "payment:read_own");
    const receipt = await receiptRepository.findByIdOrThrow(receiptId);

    if (receipt.userId !== user.uid && !user.roles.some(isAdminSystemRole)) {
      this.requirePermission(user, "payment:read_all");
      this.requireOrganizationAccess(user, receipt.organizationId);
    }

    return receipt;
  }

  /**
   * List receipts for the current user.
   */
  async listMyReceipts(user: AuthUser, pagination: { page: number; limit: number }) {
    this.requirePermission(user, "payment:read_own");
    return receiptRepository.findByUser(user.uid, pagination);
  }

  /**
   * Render + upload a PDF for a receipt and return a short-lived signed URL.
   *
   * Symmetric with badge.service.ts → generateOnDemand():
   *   - same owner/org/super_admin authorisation as getReceipt()
   *   - PDF rendered with pdf-lib (already pulled in for badges)
   *   - upload to `receipts/{eventId}/{userId}/{receiptId}.pdf`
   *   - signed URL expires after 1h (Cloud Storage V4)
   *
   * The participant-facing route only exposes this for receipts the user
   * actually owns; enforcement happens here via requireOrganizationAccess +
   * requirePermission calls already gating getReceipt().
   */
  async generateReceiptPdf(
    receiptId: string,
    user: AuthUser,
  ): Promise<{ receipt: Receipt; pdfURL: string }> {
    const receipt = await this.getReceipt(receiptId, user);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait in points
    const { width, height } = page.getSize();

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const navy = rgb(0.102, 0.102, 0.18); // teranga-navy #1A1A2E
    const gold = rgb(0.773, 0.62, 0.294); // teranga-gold #c59e4b
    const muted = rgb(0.4, 0.4, 0.4);
    const border = rgb(0.87, 0.87, 0.87);

    // Header band
    page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: navy });
    page.drawText("TERANGA EVENTS", {
      x: 40,
      y: height - 45,
      size: 14,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText("REÇU DE PAIEMENT", {
      x: 40,
      y: height - 65,
      size: 9,
      font: fontRegular,
      color: gold,
    });
    page.drawText(`N° ${receipt.receiptNumber}`, {
      x: width - 200,
      y: height - 45,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(
      new Date(receipt.issuedAt).toLocaleDateString("fr-SN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      {
        x: width - 200,
        y: height - 65,
        size: 9,
        font: fontRegular,
        color: rgb(1, 1, 1),
      },
    );

    // Organization
    page.drawText(receipt.organizationName, {
      x: 40,
      y: height - 130,
      size: 11,
      font: fontBold,
      color: navy,
    });
    page.drawText("Organisateur", {
      x: 40,
      y: height - 145,
      size: 8,
      font: fontRegular,
      color: muted,
    });

    // Divider
    page.drawLine({
      start: { x: 40, y: height - 170 },
      end: { x: width - 40, y: height - 170 },
      thickness: 0.5,
      color: border,
    });

    // Event + ticket block
    page.drawText("ÉVÉNEMENT", {
      x: 40,
      y: height - 200,
      size: 8,
      font: fontBold,
      color: muted,
    });
    page.drawText(receipt.eventTitle, {
      x: 40,
      y: height - 220,
      size: 14,
      font: fontBold,
      color: navy,
    });
    page.drawText(`Type de billet : ${receipt.ticketTypeName}`, {
      x: 40,
      y: height - 240,
      size: 10,
      font: fontRegular,
      color: navy,
    });

    // Participant block
    page.drawText("PARTICIPANT", {
      x: 40,
      y: height - 280,
      size: 8,
      font: fontBold,
      color: muted,
    });
    page.drawText(receipt.participantName, {
      x: 40,
      y: height - 300,
      size: 11,
      font: fontBold,
      color: navy,
    });
    if (receipt.participantEmail) {
      page.drawText(receipt.participantEmail, {
        x: 40,
        y: height - 315,
        size: 9,
        font: fontRegular,
        color: muted,
      });
    }

    // Total box
    const boxTop = height - 380;
    const boxBottom = boxTop - 100;
    page.drawRectangle({
      x: 40,
      y: boxBottom,
      width: width - 80,
      height: boxTop - boxBottom,
      color: rgb(0.98, 0.96, 0.9), // teranga-gold-whisper
      borderColor: gold,
      borderWidth: 0.5,
    });
    page.drawText("MONTANT PAYÉ", {
      x: 60,
      y: boxTop - 25,
      size: 8,
      font: fontBold,
      color: muted,
    });
    page.drawText(
      `${receipt.amount.toLocaleString("fr-FR").replace(/,/g, " ")} ${receipt.currency}`,
      { x: 60, y: boxTop - 60, size: 28, font: fontBold, color: navy },
    );
    const methodLabel: Record<string, string> = {
      wave: "Wave",
      orange_money: "Orange Money",
      free_money: "Free Money",
      card: "Carte bancaire",
      cash: "Espèces",
      mock: "Démo",
    };
    page.drawText(`Méthode : ${methodLabel[receipt.method] ?? receipt.method}`, {
      x: 60,
      y: boxTop - 85,
      size: 10,
      font: fontRegular,
      color: muted,
    });

    // Footer
    page.drawText(
      "Reçu émis électroniquement par Teranga Events — conservez-le pour vos déclarations.",
      {
        x: 40,
        y: 60,
        size: 8,
        font: fontRegular,
        color: muted,
      },
    );
    page.drawText(`Paiement ID · ${receipt.paymentId}`, {
      x: 40,
      y: 45,
      size: 7,
      font: fontRegular,
      color: muted,
    });

    const pdfBytes = await pdfDoc.save();

    // Upload to Cloud Storage and return a V4 signed URL (1h lifetime).
    // Matches the badge.service upload pattern.
    const bucket = storage.bucket();
    const filePath = `receipts/${receipt.eventId}/${receipt.userId}/${receipt.id}.pdf`;
    const file = bucket.file(filePath);

    await file.save(Buffer.from(pdfBytes), {
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, max-age=3600",
      },
    });

    const [pdfURL] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    return { receipt, pdfURL };
  }
}

export const receiptService = new ReceiptService();
