import crypto from "node:crypto";
import { config } from "@/config/index";

// ─── QR Code Security ────────────────────────────────────────────────────────
// v2 format: registrationId:eventId:userId:epochBase36:signature (5 parts)
// v1 format (legacy): registrationId:eventId:userId:signature (4 parts)
// v1 QR codes are still accepted for backward compatibility during migration.

export interface QrParsed {
  registrationId: string;
  eventId: string;
  userId: string;
  createdAt?: string;
}

export function hmacSign(payload: string): string {
  const hmac = crypto.createHmac("sha256", config.QR_SECRET);
  hmac.update(payload);
  return hmac.digest("hex");
}

export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function signQrPayload(registrationId: string, eventId: string, userId: string): string {
  const ts = Date.now().toString(36); // compact epoch timestamp (no colons)
  const payload = `${registrationId}:${eventId}:${userId}:${ts}`;
  const signature = hmacSign(payload);
  return `${payload}:${signature}`;
}

export function signQrPayloadV1(registrationId: string, eventId: string, userId: string): string {
  const payload = `${registrationId}:${eventId}:${userId}`;
  const signature = hmacSign(payload);
  return `${payload}:${signature}`;
}

export function verifyQrPayload(qrValue: string): QrParsed | null {
  const parts = qrValue.split(":");

  // v2 format (5 parts): id:eventId:userId:timestamp(base36):signature
  if (parts.length === 5) {
    const [registrationId, eventId, userId, ts, signature] = parts;
    const payload = `${registrationId}:${eventId}:${userId}:${ts}`;
    const expected = hmacSign(payload);
    if (!timingSafeCompare(signature, expected)) return null;
    const createdAt = new Date(parseInt(ts, 36)).toISOString();
    return { registrationId, eventId, userId, createdAt };
  }

  // v1 format (4 parts, legacy): id:eventId:userId:signature
  if (parts.length === 4) {
    const [registrationId, eventId, userId, signature] = parts;
    const payload = `${registrationId}:${eventId}:${userId}`;
    const expected = hmacSign(payload);
    if (!timingSafeCompare(signature, expected)) return null;
    return { registrationId, eventId, userId };
  }

  return null;
}
