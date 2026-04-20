import crypto from "node:crypto";
import { config } from "@/config/index";

// ─── QR Code Security ────────────────────────────────────────────────────────
// Supported QR payload formats. New registrations sign v3; v2 and v1 are still
// accepted at scan time so already-issued badges keep working through the
// rollout window.
//
//   v3 (6 parts): regId:eventId:userId:notBeforeBase36:notAfterBase36:signature
//      - `notBefore` / `notAfter` are epoch milliseconds in base36. The scan
//        path treats them as a hard validity window, so an old QR can no
//        longer be replayed months after the event.
//
//   v2 (5 parts): regId:eventId:userId:epochBase36:signature
//      - `epoch` is the issue timestamp (present but never validated).
//        Legacy: the scan path backfills the window from the event dates.
//
//   v1 (4 parts): regId:eventId:userId:signature
//      - No timestamp at all. Scan path backfills from the event dates.

export interface QrParsed {
  registrationId: string;
  eventId: string;
  userId: string;
  /** Issue timestamp (v2) or notBefore (v3). ISO 8601. */
  createdAt?: string;
  /** Earliest valid scan time — signed into v3 payloads only. ISO 8601. */
  notBefore?: string;
  /** Latest valid scan time — signed into v3 payloads only. ISO 8601. */
  notAfter?: string;
  /** Payload version — callers use this to decide whether to backfill window. */
  version: "v1" | "v2" | "v3";
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

/**
 * Sign a v3 QR payload with an embedded validity window.
 *
 * The window is baked INTO the signature, so a tamper attempt that widens
 * the bounds breaks the HMAC — no separate check needed. The scan path
 * enforces the window at validation time.
 */
export function signQrPayload(
  registrationId: string,
  eventId: string,
  userId: string,
  notBefore: number,
  notAfter: number,
): string {
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notAfter <= notBefore) {
    throw new Error(
      `signQrPayload: invalid validity window notBefore=${notBefore} notAfter=${notAfter}`,
    );
  }
  const nb = Math.floor(notBefore).toString(36);
  const na = Math.floor(notAfter).toString(36);
  const payload = `${registrationId}:${eventId}:${userId}:${nb}:${na}`;
  return `${payload}:${hmacSign(payload)}`;
}

/**
 * Legacy v2 signer — retained only for tests and one-off migration tooling.
 * Production code must use `signQrPayload` (v3).
 */
export function signQrPayloadV2(registrationId: string, eventId: string, userId: string): string {
  const ts = Date.now().toString(36);
  const payload = `${registrationId}:${eventId}:${userId}:${ts}`;
  return `${payload}:${hmacSign(payload)}`;
}

export function signQrPayloadV1(registrationId: string, eventId: string, userId: string): string {
  const payload = `${registrationId}:${eventId}:${userId}`;
  return `${payload}:${hmacSign(payload)}`;
}

export function verifyQrPayload(qrValue: string): QrParsed | null {
  const parts = qrValue.split(":");

  // v3 (6 parts): id:eventId:userId:notBefore(b36):notAfter(b36):signature
  if (parts.length === 6) {
    const [registrationId, eventId, userId, nb, na, signature] = parts;
    const payload = `${registrationId}:${eventId}:${userId}:${nb}:${na}`;
    if (!timingSafeCompare(signature, hmacSign(payload))) return null;
    const notBeforeMs = parseInt(nb, 36);
    const notAfterMs = parseInt(na, 36);
    if (!Number.isFinite(notBeforeMs) || !Number.isFinite(notAfterMs)) return null;
    return {
      registrationId,
      eventId,
      userId,
      notBefore: new Date(notBeforeMs).toISOString(),
      notAfter: new Date(notAfterMs).toISOString(),
      version: "v3",
    };
  }

  // v2 (5 parts): id:eventId:userId:timestamp(b36):signature
  if (parts.length === 5) {
    const [registrationId, eventId, userId, ts, signature] = parts;
    const payload = `${registrationId}:${eventId}:${userId}:${ts}`;
    if (!timingSafeCompare(signature, hmacSign(payload))) return null;
    const issuedMs = parseInt(ts, 36);
    if (!Number.isFinite(issuedMs)) return null;
    return {
      registrationId,
      eventId,
      userId,
      createdAt: new Date(issuedMs).toISOString(),
      version: "v2",
    };
  }

  // v1 (4 parts, legacy): id:eventId:userId:signature
  if (parts.length === 4) {
    const [registrationId, eventId, userId, signature] = parts;
    const payload = `${registrationId}:${eventId}:${userId}`;
    if (!timingSafeCompare(signature, hmacSign(payload))) return null;
    return { registrationId, eventId, userId, version: "v1" };
  }

  return null;
}

// ─── Validity window policy ─────────────────────────────────────────────────
// Single source of truth for "how long is a QR good for?". Used when
// signing a new v3 QR and when validating a legacy v1/v2 QR at scan time.

/** Hours before event start when the QR becomes valid. */
export const VALIDITY_LEAD_HOURS = 24;
/** Hours after event end when the QR expires. */
export const VALIDITY_TAIL_HOURS = 6;
/** Scan-time grace on both ends — absorbs clock skew between devices. */
export const SCAN_CLOCK_SKEW_MS = 2 * 60 * 60 * 1000;

/**
 * Compute the canonical validity window from event dates. Callers pass ISO
 * strings from the event document; we handle the Date conversion + offsets
 * in one place so the signer and the scan-time fallback can't drift.
 */
export function computeValidityWindow(
  eventStartIso: string,
  eventEndIso: string,
): { notBefore: number; notAfter: number } {
  const start = new Date(eventStartIso).getTime();
  const end = new Date(eventEndIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`computeValidityWindow: invalid event dates ${eventStartIso} / ${eventEndIso}`);
  }
  return {
    notBefore: start - VALIDITY_LEAD_HOURS * 60 * 60 * 1000,
    notAfter: end + VALIDITY_TAIL_HOURS * 60 * 60 * 1000,
  };
}

/**
 * Return value classifies a scan attempt against a validity window.
 *   - `valid`: within the window (± skew).
 *   - `too_early`: scan happened before `notBefore - skew`.
 *   - `expired`:   scan happened after  `notAfter  + skew`.
 */
export type ScanTimeVerdict = "valid" | "too_early" | "expired";

export function checkScanTime(
  nowMs: number,
  notBeforeMs: number,
  notAfterMs: number,
  skewMs: number = SCAN_CLOCK_SKEW_MS,
): ScanTimeVerdict {
  if (nowMs < notBeforeMs - skewMs) return "too_early";
  if (nowMs > notAfterMs + skewMs) return "expired";
  return "valid";
}
