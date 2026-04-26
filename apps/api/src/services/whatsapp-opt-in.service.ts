/**
 * Organizer overhaul — Phase O6.
 *
 * Manages the per-(user, organization) WhatsApp opt-in record.
 *
 * Why a dedicated service (vs. extending notification preferences):
 *
 *  - **Legal proof**: Meta requires explicit, recorded consent BEFORE
 *    the first template send. The opt-in document is the artifact a
 *    legal team will audit if a complaint lands.
 *  - **Org scope**: a participant inscribed at two orgs may opt in
 *    to one and refuse the other. Storing under `whatsappOptIns/
 *    {userId}_{organizationId}` makes that one-to-many relationship
 *    explicit.
 *  - **Append-only audit trail**: revoke flips status + sets
 *    `revokedAt`; the document is never deleted. Re-opt-in updates
 *    the existing doc back to `opted_in` and resets `revokedAt` so
 *    the historical decision is still inspectable in audit logs.
 *
 * Permission model:
 *  - The participant calls these endpoints for THEIR own (user,
 *    organisation) pair. Cross-user mutations are forbidden;
 *    super_admin bypass for support flows is intentional.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { ForbiddenError, NotFoundError } from "@/errors/app-error";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { WhatsappOptIn } from "@teranga/shared-types";

/** Stamp every emit with the standard {actorId, requestId, timestamp} envelope. */
function eventEnvelope(actorId: string) {
  const ctx = getRequestContext();
  return {
    actorId,
    requestId: ctx?.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}

export interface GrantOptInInput {
  organizationId: string;
  phoneE164: string;
}

class WhatsappOptInService extends BaseService {
  /** Build the deterministic doc id `(userId, organizationId)`. */
  private docId(userId: string, organizationId: string): string {
    return `${userId}_${organizationId}`;
  }

  /**
   * Grant opt-in for the calling user. Idempotent — re-calling on an
   * existing `opted_in` record is a no-op (no audit churn). Re-calling
   * on a `revoked` record flips it back to `opted_in` and clears
   * `revokedAt` (a separate audit row is emitted to mark the re-opt).
   */
  async grant(user: AuthUser, input: GrantOptInInput): Promise<WhatsappOptIn> {
    if (!user.uid) throw new ForbiddenError("Authentification requise");
    const id = this.docId(user.uid, input.organizationId);
    const ref = db.collection(COLLECTIONS.WHATSAPP_OPT_INS).doc(id);

    // Read-then-write must be atomic. A double-tap on the consent
    // form would otherwise let two concurrent grants both observe
    // `existing.status === "revoked"` and both stamp a fresh
    // `acceptedAt` — a legally questionable artifact for a CCPA /
    // GDPR consent record.
    const { next, idempotent, reGrant } = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(ref);
      const existing = existingSnap.exists
        ? (existingSnap.data() as WhatsappOptIn)
        : null;

      if (
        existing &&
        existing.status === "opted_in" &&
        existing.phoneE164 === input.phoneE164
      ) {
        return { next: existing, idempotent: true, reGrant: false };
      }

      const now = new Date().toISOString();
      const nextDoc: WhatsappOptIn = {
        id,
        userId: user.uid!,
        organizationId: input.organizationId,
        phoneE164: input.phoneE164,
        status: "opted_in",
        acceptedAt: now,
        revokedAt: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tx.set(ref, nextDoc);
      return {
        next: nextDoc,
        idempotent: false,
        reGrant: existing?.status === "revoked",
      };
    });

    if (idempotent) return next;

    // Emit on the SAME event for both first-time grant and re-opt: the
    // legal artifact in both cases is "consent is now active". The
    // listener wires it to the audit log.
    //
    // Privacy: the phone number is intentionally NOT in the payload —
    // it lives on the persisted `whatsappOptIns/{id}` doc and never
    // enters the audit row. CLAUDE.md PII rule.
    eventBus.emit("whatsapp.opt_in.granted", {
      ...eventEnvelope(user.uid),
      userId: user.uid,
      organizationId: input.organizationId,
      reGrant,
    });

    return next;
  }

  /** Revoke a previously-granted opt-in. 404 if no opt-in record exists. */
  async revoke(user: AuthUser, organizationId: string): Promise<WhatsappOptIn> {
    if (!user.uid) throw new ForbiddenError("Authentification requise");
    const id = this.docId(user.uid, organizationId);
    const ref = db.collection(COLLECTIONS.WHATSAPP_OPT_INS).doc(id);

    // Read-then-write atomic. The idempotency short-circuit check
    // alone doesn't close the race — two concurrent revocations
    // could both observe `status !== "revoked"` and both stamp a
    // fresh `revokedAt`.
    const { next, idempotent } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new NotFoundError(
          "Aucun opt-in WhatsApp à révoquer pour cette organisation.",
        );
      }
      const existing = snap.data() as WhatsappOptIn;
      if (existing.status === "revoked") {
        return { next: existing, idempotent: true };
      }
      const now = new Date().toISOString();
      const nextDoc: WhatsappOptIn = {
        ...existing,
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      };
      tx.set(ref, nextDoc);
      return { next: nextDoc, idempotent: false };
    });

    if (idempotent) return next;

    // Privacy: phone number stays out of the audit payload (see
    // grant() for rationale). The persisted opt-in doc keeps it.
    eventBus.emit("whatsapp.opt_in.revoked", {
      ...eventEnvelope(user.uid),
      userId: user.uid,
      organizationId,
    });

    return next;
  }

  /** Read the current opt-in record (or `null` if never granted). */
  async get(user: AuthUser, organizationId: string): Promise<WhatsappOptIn | null> {
    if (!user.uid) throw new ForbiddenError("Authentification requise");
    const id = this.docId(user.uid, organizationId);
    const snap = await db.collection(COLLECTIONS.WHATSAPP_OPT_INS).doc(id).get();
    return snap.exists ? (snap.data() as WhatsappOptIn) : null;
  }

  /**
   * Caller-friendly check used by the broadcast service before
   * dispatching a `whatsapp` channel send: returns `true` only when
   * the user has an active `opted_in` record AND the phone matches.
   */
  async hasActiveOptIn(userId: string, organizationId: string): Promise<boolean> {
    const id = this.docId(userId, organizationId);
    const snap = await db.collection(COLLECTIONS.WHATSAPP_OPT_INS).doc(id).get();
    if (!snap.exists) return false;
    const record = snap.data() as WhatsappOptIn;
    return record.status === "opted_in";
  }
}

export const whatsappOptInService = new WhatsappOptInService();
