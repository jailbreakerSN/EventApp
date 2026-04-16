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

// Per-content-type upload size ceiling. GCS enforces this via
// `x-goog-content-length-range` on the signed URL — any PUT that
// declares a Content-Length above the max is rejected with 400 by
// Cloud Storage itself (before the bytes stream), so we don't have
// to trust the client-side size check. The content-type-driven split
// is looser than tying the cap to `entityType` because the same
// entity can take images (logo, cover) AND pdfs (speaker slides).
const MAX_BYTES_BY_CONTENT_TYPE: Record<string, number> = {
  "image/jpeg": 10 * 1024 * 1024,
  "image/png": 10 * 1024 * 1024,
  "image/webp": 10 * 1024 * 1024,
  "image/gif": 10 * 1024 * 1024,
  "application/pdf": 20 * 1024 * 1024,
};

type EntityType = "event" | "organization" | "speaker" | "sponsor" | "feed";

export interface GeneratedUploadUrl {
  uploadUrl: string;
  publicUrl: string;
  /** Max bytes GCS will accept; clients should reject larger files before PUT. */
  maxBytes: number;
  /**
   * Headers the client MUST include on the PUT request. `x-goog-content-length-range`
   * is signed into the URL — omitting it produces a signature-mismatch 403 from
   * GCS. Keep the shape server-driven so clients don't drift from the
   * server's enforcement.
   */
  requiredHeaders: Record<string, string>;
}

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
  ): Promise<GeneratedUploadUrl> {
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

    // Fallback to the image ceiling if we accept a new content type later
    // and forget to register its max; safer than unbounded.
    const maxBytes = MAX_BYTES_BY_CONTENT_TYPE[dto.contentType] ?? 10 * 1024 * 1024;
    const contentLengthRangeHeader = `0,${maxBytes}`;

    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: dto.contentType,
      // extensionHeaders become part of the v4 signature. The client's PUT
      // MUST send the same header value or GCS returns 403 with
      // `SignatureDoesNotMatch`. `x-goog-content-length-range: 0,N` tells
      // GCS to reject the upload with 400 if the declared Content-Length
      // exceeds N — bound-check happens server-side at the edge, without
      // trusting the client-side size validation.
      extensionHeaders: {
        "x-goog-content-length-range": contentLengthRangeHeader,
      },
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    return {
      uploadUrl,
      publicUrl,
      maxBytes,
      requiredHeaders: {
        "x-goog-content-length-range": contentLengthRangeHeader,
      },
    };
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
