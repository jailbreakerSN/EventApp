import crypto from "node:crypto";
import { storage } from "@/config/firebase";
import { type UploadUrlRequest } from "@teranga/shared-types";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";

export class UploadService extends BaseService {
  /**
   * Generate a signed upload URL for direct client upload to Cloud Storage.
   * Flow: API returns signed URL → client PUTs file → client PATCHes event with publicUrl.
   */
  async generateUploadUrl(
    entityType: "event" | "organization",
    entityId: string,
    dto: UploadUrlRequest,
    user: AuthUser,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const permission = entityType === "event" ? "event:update" : "organization:update";
    this.requirePermission(user, permission);

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
}

export const uploadService = new UploadService();
