import crypto from "node:crypto";
import { storage } from "@/config/firebase";
import { type UploadUrlRequest } from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { speakerRepository } from "@/repositories/speaker.repository";
import { sponsorRepository } from "@/repositories/sponsor.repository";
import { ValidationError } from "@/errors/app-error";
import { registrationRepository } from "@/repositories/registration.repository";
import { BaseService } from "./base.service";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

type EntityType = "event" | "organization" | "speaker" | "sponsor" | "feed";

export class UploadService extends BaseService {
  /**
   * Generate a signed upload URL for direct client upload to Cloud Storage.
   * Flow: API returns signed URL → client PUTs file → client PATCHes entity with publicUrl.
   */
  async generateUploadUrl(
    entityType: EntityType,
    entityId: string,
    dto: UploadUrlRequest,
    user: AuthUser,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    // Resolve permission and validate entity access
    await this.validateEntityAccess(entityType, entityId, user);

    if (!ALLOWED_CONTENT_TYPES.has(dto.contentType)) {
      throw new ValidationError(
        `Content type '${dto.contentType}' is not allowed. Accepted: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
      );
    }

    const ext = dto.fileName.split(".").pop() ?? "jpg";
    const uniqueName = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const storagePath = `${entityType}s/${entityId}/${dto.purpose}/${uniqueName}`;

    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: dto.contentType,
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    return { uploadUrl, publicUrl };
  }

  private async validateEntityAccess(
    entityType: EntityType,
    entityId: string,
    user: AuthUser,
  ): Promise<void> {
    switch (entityType) {
      case "event": {
        this.requirePermission(user, "event:update");
        const event = await eventRepository.findByIdOrThrow(entityId);
        this.requireOrganizationAccess(user, event.organizationId);
        break;
      }
      case "organization": {
        this.requirePermission(user, "organization:update");
        await organizationRepository.findByIdOrThrow(entityId);
        this.requireOrganizationAccess(user, entityId);
        break;
      }
      case "speaker": {
        // Organizers can upload for any speaker; speakers can upload for themselves
        const speaker = await speakerRepository.findByIdOrThrow(entityId);
        if (speaker.userId === user.uid) {
          this.requirePermission(user, "speaker:update_own");
        } else {
          this.requirePermission(user, "event:update");
          this.requireOrganizationAccess(user, speaker.organizationId);
        }
        break;
      }
      case "sponsor": {
        // Organizers can upload for any sponsor; sponsors can upload for themselves
        const sponsor = await sponsorRepository.findByIdOrThrow(entityId);
        if (sponsor.userId === user.uid) {
          this.requirePermission(user, "sponsor:manage_booth");
        } else {
          this.requirePermission(user, "event:update");
          this.requireOrganizationAccess(user, sponsor.organizationId);
        }
        break;
      }
      case "feed": {
        // Any registered participant with feed:create_post permission can upload
        this.requirePermission(user, "feed:create_post");
        const registration = await registrationRepository.findExisting(entityId, user.uid);
        if (!registration) {
          throw new ValidationError("You must be registered for this event to upload feed images");
        }
        break;
      }
    }
  }
}

export const uploadService = new UploadService();
