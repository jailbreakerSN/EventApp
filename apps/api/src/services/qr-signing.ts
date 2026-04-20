import crypto from "node:crypto";
import { config } from "@/config/index";

// ─── QR Code Security ────────────────────────────────────────────────────────
// Supported QR payload formats. New registrations sign v4; older formats are
// still accepted at scan time so already-issued badges keep working through
// the rollout window.
//
//   v4 (7 parts): regId:eventId:userId:notBeforeBase36:notAfterBase36:kid:signature
//      - `kid` is an 8-char base36 identifier resolved to a per-event HMAC
//        key via HKDF-SHA256(QR_MASTER, salt=eventId,
//        info="teranga/qr/v4/${kid}"). Rotation → new kid on the event →
//        new derived key → newly-issued badges verify under the new key;
//        already-issued badges keep verifying because their kid is in the
//        payload and the retired kid stays in `event.qrKidHistory` until
//        the operator forcibly re-seals.
//
//   v3 (6 parts): regId:eventId:userId:notBeforeBase36:notAfterBase36:signature
//      - `notBefore` / `notAfter` are epoch milliseconds in base36. The scan
//        path treats them as a hard validity window. Signed with the legacy
//        global `QR_SECRET` key.
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
  /** Earliest valid scan time — signed into v3+v4 payloads. ISO 8601. */
  notBefore?: string;
  /** Latest valid scan time — signed into v3+v4 payloads. ISO 8601. */
  notAfter?: string;
  /** Signing key id — signed into v4 payloads only. */
  kid?: string;
  /** Payload version — callers use this to decide whether to backfill window. */
  version: "v1" | "v2" | "v3" | "v4";
}

export function hmacSign(payload: string): string {
  const hmac = crypto.createHmac("sha256", config.QR_SECRET);
  hmac.update(payload);
  return hmac.digest("hex");
}

/**
 * HMAC-SHA256 with an explicit key. Used by the v4 path where each event
 * owns a derived key rather than sharing the global `QR_SECRET`.
 */
export function hmacSignWithKey(key: Buffer, payload: string): string {
  const hmac = crypto.createHmac("sha256", key);
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

// ─── v4: per-event HKDF-derived keys + kid rotation ────────────────────────
// HKDF-SHA256 domain-separates events (salt = eventId) and key generations
// (info carries the kid). QR_MASTER is distinct from QR_SECRET so the v4
// rollout can proceed without touching the v3 key path. When QR_MASTER is
// unset in config we fall back to QR_SECRET — transitional, production
// should provision both until every live event has been migrated to v4.

const V4_HKDF_INFO_PREFIX = "teranga/qr/v4/";
const V4_KEY_LEN = 32;
/** Base36 alphabet subset used when generating kids — alnum, no ambiguity. */
const V4_KID_LEN = 8;

/** Generate a fresh 8-char base36 `kid`. Used on event create + rotation. */
export function generateEventKid(): string {
  // 5 random bytes gives us ≈ 40 bits of entropy — plenty for "unique
  // across this event's rotation history" while keeping the QR compact.
  const raw = crypto.randomBytes(5).readUIntBE(0, 5);
  return raw.toString(36).padStart(V4_KID_LEN, "0").slice(-V4_KID_LEN);
}

// Tracks whether we've already warned about the `QR_MASTER → QR_SECRET`
// fallback, to avoid spamming stderr once per v4 sign/verify.
let v4FallbackWarned = false;

function v4MasterKey(): Buffer {
  if (config.QR_MASTER) return Buffer.from(config.QR_MASTER, "utf8");

  // Fallback path — v4 deriving a key from QR_SECRET means an attacker
  // who steals QR_SECRET (the v3 global key) can also mint v4 keys for
  // every event. That defeats the isolation property of v4. We log
  // loudly so operators notice, and hard-fail in production so the
  // deployment can't silently ship without QR_MASTER set.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "QR_MASTER is required in production. v4 signing cannot fall back to QR_SECRET — " +
        "that would collapse the v3/v4 key isolation. Set QR_MASTER to a distinct secret " +
        "(≥32 chars) and redeploy.",
    );
  }
  if (!v4FallbackWarned) {
    v4FallbackWarned = true;
    process.stderr.write(
      "[qr-signing] WARN QR_MASTER unset — v4 signing falls back to QR_SECRET. " +
        "Per-event key isolation is REDUCED until QR_MASTER is set. Production boots will refuse.\n",
    );
  }
  return Buffer.from(config.QR_SECRET, "utf8");
}

/**
 * Derive the per-event HMAC key for v4 signing. Pure function — callers
 * pass the `kid` they looked up on the event document (or `undefined` for
 * the freshly-rotated current kid). Returns a 32-byte key suitable for
 * HMAC-SHA256.
 */
export function deriveEventKey(eventId: string, kid: string): Buffer {
  if (!eventId) throw new Error("deriveEventKey: eventId required");
  if (!kid) throw new Error("deriveEventKey: kid required");
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      v4MasterKey(),
      Buffer.from(eventId, "utf8"),
      Buffer.from(V4_HKDF_INFO_PREFIX + kid, "utf8"),
      V4_KEY_LEN,
    ),
  );
}

/**
 * Sign a v4 payload. `kid` goes BEFORE the signature so the parser's
 * `parts.length` dispatch still lands the signature in the last slot —
 * v1/v2/v3 branches keep working unchanged.
 */
export function signQrPayloadV4(
  registrationId: string,
  eventId: string,
  userId: string,
  notBefore: number,
  notAfter: number,
  kid: string,
): string {
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notAfter <= notBefore) {
    throw new Error(
      `signQrPayloadV4: invalid validity window notBefore=${notBefore} notAfter=${notAfter}`,
    );
  }
  if (!/^[0-9a-z]{4,16}$/.test(kid)) {
    throw new Error(`signQrPayloadV4: invalid kid ${kid}`);
  }
  const nb = Math.floor(notBefore).toString(36);
  const na = Math.floor(notAfter).toString(36);
  const payload = `${registrationId}:${eventId}:${userId}:${nb}:${na}:${kid}`;
  const key = deriveEventKey(eventId, kid);
  return `${payload}:${hmacSignWithKey(key, payload)}`;
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

/**
 * Resolver for v4 per-event keys. Caller's responsibility to look up the
 * event's `qrKid` (and `qrKidHistory` for rotation-window overlap) and
 * call `deriveEventKey` — we keep the crypto module independent of the
 * repository layer. When the resolver is omitted, v4 payloads are
 * rejected (fail-closed), so the sync legacy callers keep working
 * without risk of silently accepting a v4 that was never verified.
 */
export type EventKeyResolver = (
  eventId: string,
  kid: string,
) => Promise<Buffer | null> | Buffer | null;

export async function verifyQrPayload(
  qrValue: string,
  resolveEventKey?: EventKeyResolver,
): Promise<QrParsed | null> {
  const parts = qrValue.split(":");

  // v4 (7 parts): id:eventId:userId:notBefore:notAfter:kid:signature
  if (parts.length === 7) {
    const [registrationId, eventId, userId, nb, na, kid, signature] = parts;
    if (!/^[0-9a-z]{4,16}$/.test(kid)) return null;
    // Fail closed: a v4 payload with no resolver cannot be verified.
    // Unawaited-Promise-truthy footgun is gone — callers await this
    // function, and the static type forces them to.
    if (!resolveEventKey) return null;
    const key = await resolveEventKey(eventId, kid);
    if (!key) return null;
    const payload = `${registrationId}:${eventId}:${userId}:${nb}:${na}:${kid}`;
    if (!timingSafeCompare(signature, hmacSignWithKey(key, payload))) return null;
    const notBeforeMs = parseInt(nb, 36);
    const notAfterMs = parseInt(na, 36);
    if (!Number.isFinite(notBeforeMs) || !Number.isFinite(notAfterMs)) return null;
    return {
      registrationId,
      eventId,
      userId,
      notBefore: new Date(notBeforeMs).toISOString(),
      notAfter: new Date(notAfterMs).toISOString(),
      kid,
      version: "v4",
    };
  }

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
