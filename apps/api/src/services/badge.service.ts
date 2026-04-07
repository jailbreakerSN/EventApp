import {
  type GeneratedBadge,
  type OfflineEventData,
  type Registration,
} from "@teranga/shared-types";
import { type DocumentSnapshot } from "firebase-admin/firestore";
import { db, storage, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  NotFoundError,
  ValidationError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

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
  async generate(registrationId: string, templateId: string, user: AuthUser): Promise<GeneratedBadge> {
    this.requirePermission(user, "badge:generate");

    const registration = await registrationRepository.findByIdOrThrow(registrationId);

    if (registration.status !== "confirmed" && registration.status !== "checked_in") {
      throw new ValidationError("Le badge ne peut être généré que pour les inscriptions confirmées");
    }

    // Verify template exists
    const templateDoc = await this.templatesCollection.doc(templateId).get();
    if (!templateDoc.exists) {
      throw new NotFoundError("BadgeTemplate", templateId);
    }

    // Verify user has access to the event's organization
    const event = await eventRepository.findByIdOrThrow(registration.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Check if badge already exists
    const existingSnap = await this.badgesCollection
      .where("registrationId", "==", registrationId)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // Return existing badge instead of creating duplicate
      const doc = existingSnap.docs[0];
      return { id: doc.id, ...doc.data() } as GeneratedBadge;
    }

    // Create badge doc — Cloud Function picks it up
    const now = new Date().toISOString();
    const docRef = this.badgesCollection.doc();
    const badge: GeneratedBadge = {
      id: docRef.id,
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

    await docRef.set(badge);

    eventBus.emit("badge.generated", {
      badgeId: badge.id,
      registrationId,
      eventId: registration.eventId,
      userId: registration.userId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return badge;
  }

  /**
   * Bulk generate badges for all confirmed registrations of an event.
   * Uses cursor-based pagination to avoid loading all registrations into memory.
   */
  async bulkGenerate(eventId: string, templateId: string, user: AuthUser): Promise<{ queued: number }> {
    this.requirePermission(user, "badge:bulk_generate");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const templateDoc = await this.templatesCollection.doc(templateId).get();
    if (!templateDoc.exists) {
      throw new NotFoundError("BadgeTemplate", templateId);
    }

    // Find which registrations already have badges
    const existingBadgesSnap = await this.badgesCollection
      .where("eventId", "==", eventId)
      .get();
    const existingRegIds = new Set(existingBadgesSnap.docs.map((d) => d.data().registrationId));

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

      // Filter out registrations that already have badges
      const toCreate = page.data.filter((reg) => !existingRegIds.has(reg.id));
      if (toCreate.length === 0) continue;

      // New batch per chunk to keep memory bounded
      const batch = db.batch();
      for (const reg of toCreate) {
        const docRef = this.badgesCollection.doc();
        batch.set(docRef, {
          id: docRef.id,
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
        queued++;
      }

      await batch.commit();
    }

    return { queued };
  }

  /**
   * Get a user's own badge for an event.
   */
  async getMyBadge(eventId: string, user: AuthUser): Promise<GeneratedBadge> {
    this.requirePermission(user, "badge:view_own");

    const snap = await this.badgesCollection
      .where("eventId", "==", eventId)
      .where("userId", "==", user.uid)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new NotFoundError("Badge");
    }

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as GeneratedBadge;
  }

  /**
   * Get a download URL for a badge PDF.
   * Generates a fresh signed URL from Cloud Storage (the stored pdfURL may expire).
   */
  async download(badgeId: string, user: AuthUser): Promise<{ downloadUrl: string }> {
    const snap = await this.badgesCollection.doc(badgeId).get();
    if (!snap.exists) throw new NotFoundError("Badge", badgeId);

    const badge = { id: snap.id, ...snap.data() } as GeneratedBadge;

    // Check access: own badge or badge:generate permission with org verification
    if (badge.userId !== user.uid) {
      this.requirePermission(user, "badge:generate");
      const event = await eventRepository.findByIdOrThrow(badge.eventId);
      this.requireOrganizationAccess(user, event.organizationId);
    }

    if (badge.status === "failed") {
      throw new ValidationError(`Badge generation failed: ${badge.error ?? "unknown error"}`);
    }

    if (!badge.pdfURL) {
      throw new ValidationError("Le PDF du badge n'a pas encore été généré");
    }

    // Generate fresh signed URL from the known storage path
    const storagePath = `badges/${badge.eventId}/${badge.userId}/${badge.id}.pdf`;
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    const [downloadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    // Increment download counter (fire-and-forget, log errors with context)
    const reqId = getRequestId();
    this.badgesCollection.doc(badgeId).update({
      downloadCount: (badge.downloadCount ?? 0) + 1,
    }).catch((err: unknown) => {
      process.stderr.write(`[BadgeService] reqId=${reqId} Failed to increment download counter for badge ${badgeId}: ${err}\n`);
    });

    return { downloadUrl };
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

    return {
      eventId,
      downloadedAt: new Date().toISOString(),
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
          status: reg.status === "checked_in" ? "confirmed" as const : reg.status as "confirmed" | "waitlisted",
          checkedIn: reg.status === "checked_in",
          checkedInAt: reg.checkedInAt ?? null,
        };
      }),
    };
  }

}

export const badgeService = new BadgeService();
