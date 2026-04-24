import crypto from "crypto";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { db, auth, COLLECTIONS } from "@/config/firebase";
import { config } from "@/config/index";
import { AppError, ForbiddenError, NotFoundError, ConflictError } from "@/errors/app-error";
import { getRequestId } from "@/context/request-context";
import { eventBus } from "@/events/event-bus";
import { ERROR_CODES, type UserProfile } from "@teranga/shared-types";

/**
 * OAuth-style authorization-code flow for cross-origin impersonation.
 *
 * See `packages/shared-types/src/impersonation.types.ts` for the full
 * security rationale. In short: the raw custom token must never touch
 * a URL, history entry, or log line. The code is an opaque, single-use,
 * origin-bound, 60-second-TTL handle to the token.
 *
 * Two responsibilities:
 *   - `issue()` — called by AdminService.startImpersonation after it
 *     has authorised the admin and validated the target. We persist
 *     a SHA-256 hash of the code (never the code itself), along with
 *     the target uid, the canonical target origin, and the admin's
 *     audit fingerprint (uid, ip, ua). Return the raw code + absolute
 *     accept URL so the admin's browser can open the target app.
 *   - `exchange()` — called by the PUBLIC /v1/impersonation/exchange
 *     route. Validates code existence, TTL, single-use, and origin
 *     binding inside a Firestore transaction that atomically marks
 *     the row `consumedAt`. Reads the target profile fresh (defence
 *     against admin-edited claims between issue and consume) and
 *     mints the Firebase custom token with the impersonation claims.
 */

// Roles that belong to the organizer / venue / admin shells — these
// targets should open the BACKOFFICE app. Anything else (participant,
// speaker, sponsor, staff) lands on the PARTICIPANT app. Mirror of the
// client-side BACKOFFICE_ROLE_SET in use-impersonation.ts — kept here
// because the server must authoritatively compute the target origin,
// not trust a client hint.
const BACKOFFICE_ROLES = new Set<string>([
  "organizer",
  "co_organizer",
  "venue_manager",
  "super_admin",
  "platform:super_admin",
  "platform:support",
  "platform:finance",
  "platform:ops",
  "platform:security",
]);

// 60-second TTL on an unconsumed code. Long enough for the admin's
// browser to round-trip a `window.open` + Next.js route hydration on
// the slowest staging path; short enough that a leaked URL (Referer,
// clipboard paste) is dead before it can be misused.
const CODE_TTL_MS = 60_000;

// 30-minute cap on the resulting session. Mirrors the legacy direct-
// token flow and matches the Phase 4 design review. If we ever extend
// this, bump the claim + document it in CLAUDE.md under QR security.
const SESSION_TTL_MS = 30 * 60_000;

// Opaque random 32-byte code, base64url encoded. 43 chars, URL-safe,
// ~256 bits of entropy. The key space is large enough that exhaustion
// under a 30 req/min/IP rate limit is cryptographically infeasible.
function generateRawCode(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashCode(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function originForRoles(roles: readonly string[]): string {
  const hasBackofficeRole = roles.some((r) => BACKOFFICE_ROLES.has(r));
  return hasBackofficeRole ? config.WEB_BACKOFFICE_URL : config.PARTICIPANT_WEB_URL;
}

export interface IssueParams {
  admin: AuthUser;
  actorDisplayName: string | null;
  actorRole: string;
  target: UserProfile;
  /** Raw request IP at issue time — stamped on the audit row. */
  issueIp: string | null;
  /** Raw request User-Agent at issue time. */
  issueUa: string | null;
}

export interface IssueResult {
  code: string;
  acceptUrl: string;
  targetOrigin: string;
  expiresAt: string;
  targetUid: string;
  targetDisplayName: string | null;
  targetEmail: string | null;
  targetRoles: string[];
}

export interface ExchangeParams {
  code: string;
  /** Browser-reported Origin of the exchange request. */
  origin: string | null;
  /** Consumer's IP — stamped on the audit row. */
  consumeIp: string | null;
  /** Consumer's User-Agent. */
  consumeUa: string | null;
}

export interface ExchangeResult {
  customToken: string;
  actorUid: string;
  actorDisplayName: string | null;
  targetUid: string;
  targetDisplayName: string | null;
  targetEmail: string | null;
  expiresAt: string;
}

class ImpersonationCodeService {
  async issue(params: IssueParams): Promise<IssueResult> {
    const now = Date.now();
    const expiresAtMs = now + CODE_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const issuedAt = new Date(now).toISOString();

    const targetRoles = params.target.roles ?? [];
    const targetOrigin = originForRoles(targetRoles);

    const rawCode = generateRawCode();
    const codeHash = hashCode(rawCode);

    await db
      .collection(COLLECTIONS.IMPERSONATION_CODES)
      .doc(codeHash)
      .set({
        adminUid: params.admin.uid,
        adminDisplayName: params.actorDisplayName,
        actorRole: params.actorRole,
        targetUid: params.target.uid,
        targetDisplayName: params.target.displayName ?? null,
        targetEmail: params.target.email ?? null,
        targetOrigin,
        issuedAt,
        // Firestore TTL deletes rows where `expiresAt` is in the past.
        // Keep it as a Date (Timestamp) so the TTL policy picks it up.
        // The ISO string lives alongside as `expiresAtIso` for audit.
        expiresAt: new Date(expiresAtMs),
        expiresAtIso: expiresAt,
        consumedAt: null,
        issueIp: params.issueIp,
        issueUa: params.issueUa,
        requestId: getRequestId(),
      });

    const acceptUrl = new URL("/impersonation/accept", targetOrigin);
    acceptUrl.searchParams.set("code", rawCode);

    return {
      code: rawCode,
      acceptUrl: acceptUrl.toString(),
      targetOrigin,
      expiresAt,
      targetUid: params.target.uid,
      targetDisplayName: params.target.displayName ?? null,
      targetEmail: params.target.email ?? null,
      targetRoles,
    };
  }

  async exchange(params: ExchangeParams): Promise<ExchangeResult> {
    const codeHash = hashCode(params.code);
    const codeRef = db.collection(COLLECTIONS.IMPERSONATION_CODES).doc(codeHash);

    // Transaction 1 — validate + mark consumed atomically. Every
    // validation failure below throws a typed AppError; the
    // transaction automatically rolls back on throw. Single-use
    // guarantee is enforced by the tx.update on `consumedAt` — two
    // concurrent exchanges serialise through Firestore and exactly
    // one wins.
    const consumed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) {
        throw new NotFoundError("Impersonation code");
      }
      const data = snap.data() as {
        adminUid: string;
        adminDisplayName: string | null;
        actorRole: string;
        targetUid: string;
        targetDisplayName: string | null;
        targetEmail: string | null;
        targetOrigin: string;
        issuedAt: string;
        expiresAt: FirebaseFirestore.Timestamp | Date;
        expiresAtIso: string;
        consumedAt: string | null;
        issueIp: string | null;
        issueUa: string | null;
      };

      if (data.consumedAt) {
        throw new ConflictError("Impersonation code already used", {
          reason: "impersonation_code_consumed",
        });
      }

      // `expiresAt` is a Firestore Timestamp in production but a
      // plain Date in tests (we seed `new Date(...)`). Handle both.
      const expiresAtMs =
        data.expiresAt instanceof Date
          ? data.expiresAt.getTime()
          : (data.expiresAt as FirebaseFirestore.Timestamp).toMillis();
      if (expiresAtMs < Date.now()) {
        throw new AppError({
          code: ERROR_CODES.IMPERSONATION_CODE_EXPIRED,
          message: "Lien d'impersonation expiré. Relancez l'opération depuis le back-office.",
          statusCode: 410,
        });
      }

      if (!params.origin || params.origin !== data.targetOrigin) {
        // Security note (review #1, MEDIUM): do NOT echo `targetOrigin`
        // on this error response. An attacker who captured a valid
        // code would otherwise learn from the 403 body which app the
        // code was issued for, which is itself a signal. A valid
        // caller already knows their origin; a foreign caller has no
        // business knowing the legitimate one. Structured stderr log
        // below keeps the diagnostic for ops.
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            event: "impersonation.origin_mismatch",
            expectedOrigin: data.targetOrigin,
            receivedOrigin: params.origin ?? null,
            targetUid: data.targetUid,
            consumeIp: params.consumeIp,
          }) + "\n",
        );
        throw new AppError({
          code: ERROR_CODES.IMPERSONATION_ORIGIN_MISMATCH,
          message: "Ce code ne peut pas être consommé depuis cette application.",
          statusCode: 403,
        });
      }

      const consumedAt = new Date().toISOString();
      tx.update(codeRef, {
        consumedAt,
        consumeIp: params.consumeIp,
        consumeUa: params.consumeUa,
      });

      return { data, consumedAt };
    });

    // Fresh profile read — defence against an admin editing the
    // target's roles between issue (T0) and exchange (T0 + ≤60s).
    // If the target has been soft-deleted in that window we treat
    // the exchange as invalid — don't mint a token into a dead user.
    const targetDoc = await db.collection(COLLECTIONS.USERS).doc(consumed.data.targetUid).get();
    if (!targetDoc.exists) {
      throw new AppError({
        code: ERROR_CODES.IMPERSONATION_CODE_INVALID,
        message: "L'utilisateur ciblé n'existe plus.",
        statusCode: 404,
      });
    }
    const freshProfile = targetDoc.data() as UserProfile;

    // Closure-parity guard: if the target became a top-tier admin
    // between issue and exchange (rare but possible), refuse — the
    // admin role gate on startImpersonation would never have let
    // this through today.
    const freshRoles = freshProfile.roles ?? [];
    const freshIsTopAdmin =
      freshRoles.includes("super_admin") || freshRoles.includes("platform:super_admin");
    if (freshIsTopAdmin) {
      throw new ForbiddenError("Cannot impersonate another super_admin.");
    }

    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    // Build developer claims. Omit null-valued keys — the Cloud Run
    // `iamcredentials.signBlob` path rejects payloads that carry
    // explicit nulls on custom claim slots. Matches the legacy
    // AdminService.startImpersonation hygiene.
    const claims: Record<string, unknown> = {
      impersonatedBy: consumed.data.adminUid,
      impersonationExpiresAt: sessionExpiresAt,
      roles: freshRoles,
    };
    if (freshProfile.organizationId) {
      claims.organizationId = freshProfile.organizationId;
    }
    if (freshProfile.orgRole) {
      claims.orgRole = freshProfile.orgRole;
    }

    let customToken: string;
    try {
      customToken = await auth.createCustomToken(consumed.data.targetUid, claims);
    } catch (err) {
      // Same failure mode as the legacy flow — surface a 503 with the
      // Firebase error code so ops can distinguish an IAM binding
      // issue from a generic 500.
      const message = err instanceof Error ? err.message : String(err);
      const firebaseCode =
        (err as { code?: string; errorInfo?: { code?: string } })?.code ??
        (err as { errorInfo?: { code?: string } })?.errorInfo?.code ??
        "unknown";
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "impersonation.exchange_sign_failed",
          targetUid: consumed.data.targetUid,
          actorId: consumed.data.adminUid,
          firebaseCode,
          message,
          hint: "If code contains 'iamcredentials' or 'signBlob', grant roles/iam.serviceAccountTokenCreator on the Cloud Run runtime SA to itself. See deploy-staging.yml.",
        }) + "\n",
      );
      throw new AppError({
        code: ERROR_CODES.IMPERSONATION_SIGNING_UNAVAILABLE,
        message:
          "Service d'authentification indisponible : la génération du token d'impersonation a échoué. L'équipe technique a été notifiée dans les logs applicatifs.",
        statusCode: 503,
        details: { firebaseCode },
      });
    }

    // Audit row — one per EXCHANGE. Separate action string so a reader
    // can distinguish the issue event from the exchange event on the
    // audit timeline. Same request id binds them together.
    await db.collection(COLLECTIONS.AUDIT_LOGS).add({
      action: "user.impersonation_exchanged",
      actorId: consumed.data.adminUid,
      actorRole: consumed.data.actorRole,
      resourceType: "user",
      resourceId: consumed.data.targetUid,
      organizationId: freshProfile.organizationId ?? null,
      details: {
        issuedAt: consumed.data.issuedAt,
        consumedAt: consumed.consumedAt,
        targetOrigin: consumed.data.targetOrigin,
        consumeIp: params.consumeIp,
        consumeUa: params.consumeUa,
        sessionExpiresAt,
      },
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    eventBus.emit("user.impersonation_exchanged", {
      actorUid: consumed.data.adminUid,
      targetUid: consumed.data.targetUid,
      expiresAt: sessionExpiresAt,
    });

    return {
      customToken,
      actorUid: consumed.data.adminUid,
      actorDisplayName: consumed.data.adminDisplayName,
      targetUid: consumed.data.targetUid,
      targetDisplayName: freshProfile.displayName ?? null,
      targetEmail: freshProfile.email ?? null,
      expiresAt: sessionExpiresAt,
    };
  }
}

export const impersonationCodeService = new ImpersonationCodeService();
