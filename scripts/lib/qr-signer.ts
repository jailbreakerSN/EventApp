/**
 * Self-contained v3 QR signer for the seed scripts.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `apps/api/src/services/qr-signing.ts` owns the production signer, but
 * importing it from the seed pulls in `apps/api/src/config/index.ts`
 * which validates the entire API env (Firestore creds, Resend key,
 * Sentry DSN, etc.). The seed runs in a much leaner Node context — that
 * validator would refuse to load.
 *
 * So we duplicate **just** the v3 wire format here, keyed off
 * `process.env.QR_SECRET` (the same env var the API reads). When the
 * seed runs against:
 *   - **the emulator**, both signer + scanner default to
 *     `DEV_QR_SECRET` below, so seeded badges scan successfully.
 *   - **staging**, the workflow injects the real `QR_SECRET` to both
 *     processes (see `.github/workflows/seed-staging.yml` + the API's
 *     Cloud Run env), so seeded badges remain scannable end-to-end.
 *
 * If you change the v3 wire format in `apps/api/src/services/qr-signing.ts`
 * you MUST mirror the change here. `apps/api/src/services/__tests__/qr-signing.test.ts`
 * is the canonical reference.
 *
 * v3 format (6 parts):
 *   `regId:eventId:userId:notBeforeBase36:notAfterBase36:hmacSignatureHex`
 *
 * The validity window (notBefore/notAfter, epoch ms in base36) is
 * baked INTO the signature, so a tamper attempt that widens the bounds
 * breaks the HMAC.
 */

import crypto from "node:crypto";

/**
 * Default secret used when `QR_SECRET` is not set in the environment.
 * Must match `apps/api/.env.example` so a fresh local clone can scan
 * badges produced by `npm run seed` without manual env setup.
 *
 * The minimum length (32 chars) matches the API's Zod validator at
 * `apps/api/src/config/index.ts:123`.
 */
const DEV_QR_SECRET = "change-me-QR-signing-secret-must-be-at-least-32-chars";

const QR_SECRET = process.env.QR_SECRET ?? DEV_QR_SECRET;

if (QR_SECRET.length < 16) {
  throw new Error(
    `seed/qr-signer: QR_SECRET must be at least 16 chars (got ${QR_SECRET.length}). ` +
      `Set QR_SECRET in the environment or rely on the bundled DEV_QR_SECRET.`,
  );
}

/**
 * Sign a v3 QR payload. Mirrors `apps/api/src/services/qr-signing.ts:signQrPayload`.
 *
 * @param registrationId - Stable registration id (e.g. `reg-syn-00042`).
 * @param eventId        - Event id (e.g. `event-syn-001`).
 * @param userId         - Participant uid (e.g. `participant-uid-007`).
 * @param notBeforeMs    - Earliest valid scan time in epoch ms.
 * @param notAfterMs     - Latest valid scan time in epoch ms (must be > notBefore).
 * @returns The full v3 wire-format string.
 */
export function signSeedQrV3(
  registrationId: string,
  eventId: string,
  userId: string,
  notBeforeMs: number,
  notAfterMs: number,
): string {
  if (
    !Number.isFinite(notBeforeMs) ||
    !Number.isFinite(notAfterMs) ||
    notAfterMs <= notBeforeMs
  ) {
    throw new Error(
      `signSeedQrV3: invalid validity window notBefore=${notBeforeMs} notAfter=${notAfterMs}`,
    );
  }
  const nb = Math.floor(notBeforeMs).toString(36);
  const na = Math.floor(notAfterMs).toString(36);
  const payload = `${registrationId}:${eventId}:${userId}:${nb}:${na}`;
  const signature = crypto.createHmac("sha256", QR_SECRET).update(payload).digest("hex");
  return `${payload}:${signature}`;
}

/**
 * Convenience wrapper that derives the default validity window from an
 * event's `startDate` / `endDate` (ISO 8601 strings), matching the
 * default backfill the API scan path applies for v1/v2 QRs:
 *   notBefore = event.startDate − 24 h
 *   notAfter  = event.endDate   + 6 h
 */
export function signSeedQrV3FromEvent(
  registrationId: string,
  eventId: string,
  userId: string,
  eventStartDate: string,
  eventEndDate: string,
): string {
  const startMs = new Date(eventStartDate).getTime();
  const endMs = new Date(eventEndDate).getTime();
  const notBefore = startMs - 24 * 3_600_000;
  const notAfter = endMs + 6 * 3_600_000;
  return signSeedQrV3(registrationId, eventId, userId, notBefore, notAfter);
}
