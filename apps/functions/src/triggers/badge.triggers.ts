import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db, storage, COLLECTIONS } from "../utils/admin";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

/**
 * Generate a badge PDF when a new badge document is created.
 * Triggered by Firestore onCreate on /badges/{badgeId}.
 */
export const onBadgeCreated = onDocumentCreated(
  {
    document: `${COLLECTIONS.BADGES}/{badgeId}`,
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.error("Badge trigger: no data in event");
      return;
    }

    const badge = snapshot.data();
    const badgeId = snapshot.id;
    const { registrationId, eventId, userId, templateId } = badge;

    try {
      // Fetch necessary data in parallel
      const [regDoc, eventDoc, userDoc] = await Promise.all([
        db.collection(COLLECTIONS.REGISTRATIONS).doc(registrationId).get(),
        db.collection(COLLECTIONS.EVENTS).doc(eventId).get(),
        db.collection(COLLECTIONS.USERS).doc(userId).get(),
      ]);

      if (!regDoc.exists || !eventDoc.exists || !userDoc.exists) {
        logger.error(`Badge ${badgeId}: missing related documents`, {
          reg: regDoc.exists,
          event: eventDoc.exists,
          user: userDoc.exists,
        });
        return;
      }

      const reg = regDoc.data()!;
      const eventData = eventDoc.data()!;
      const user = userDoc.data()!;

      // Fetch template if specified, else use defaults
      let template: Record<string, unknown> = {
        backgroundColor: "#FFFFFF",
        primaryColor: "#1A1A2E",
        width: 85.6,   // mm — ISO 7810 ID-1 card
        height: 54.0,  // mm
      };

      if (templateId) {
        const tplDoc = await db.collection(COLLECTIONS.BADGE_TEMPLATES).doc(templateId).get();
        if (tplDoc.exists) template = { ...template, ...tplDoc.data() };
      }

      // Generate QR code as base64 PNG
      const qrPngBase64 = await QRCode.toDataURL(badge.qrCodeValue, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 200,
      });
      const qrImageBytes = Buffer.from(qrPngBase64.split(",")[1], "base64");

      // Build PDF badge
      const pdfDoc = await PDFDocument.create();
      const mmToPoints = (mm: number) => mm * 2.83465;

      const page = pdfDoc.addPage([
        mmToPoints(template.width as number),
        mmToPoints(template.height as number),
      ]);

      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const hexToRgb = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return rgb(r, g, b);
      };

      const { width, height } = page.getSize();
      const primaryRgb = hexToRgb(template.primaryColor as string);
      const bgRgb = hexToRgb(template.backgroundColor as string);

      // Background
      page.drawRectangle({ x: 0, y: 0, width, height, color: bgRgb });

      // Header bar
      page.drawRectangle({ x: 0, y: height - 30, width, height: 30, color: primaryRgb });

      // Event name in header
      page.drawText((eventData.title ?? "Event").slice(0, 40), {
        x: 8,
        y: height - 20,
        size: 9,
        font: fontBold,
        color: rgb(1, 1, 1),
      });

      // Participant name
      page.drawText(user.displayName ?? "Participant", {
        x: 8,
        y: height - 55,
        size: 13,
        font: fontBold,
        color: primaryRgb,
      });

      // Ticket type
      const ticketType = (eventData.ticketTypes ?? []).find(
        (t: { id: string }) => t.id === reg.ticketTypeId,
      );
      page.drawText((ticketType as { name?: string })?.name ?? "Participant", {
        x: 8,
        y: height - 70,
        size: 9,
        font: fontRegular,
        color: primaryRgb,
      });

      // QR code
      const qrImage = await pdfDoc.embedPng(qrImageBytes);
      page.drawImage(qrImage, {
        x: width - 80,
        y: 10,
        width: 65,
        height: 65,
      });

      const pdfBytes = await pdfDoc.save();

      // Upload to Cloud Storage
      const bucket = storage.bucket();
      const filePath = `badges/${eventId}/${userId}/${badgeId}.pdf`;
      const file = bucket.file(filePath);

      await file.save(Buffer.from(pdfBytes), {
        metadata: {
          contentType: "application/pdf",
          cacheControl: "public, max-age=604800", // 7 days
        },
      });

      const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Update badge document with PDF URL
      await snapshot.ref.update({ pdfURL: signedUrl });

      logger.info(`Badge PDF generated for ${badgeId}`, {
        eventId,
        userId,
        filePath,
      });
    } catch (err) {
      logger.error(`Badge PDF generation failed for ${badgeId}`, err);
      // Mark badge as failed so client can retry
      await snapshot.ref.update({ pdfURL: null, error: "generation_failed" });
    }
  },
);
