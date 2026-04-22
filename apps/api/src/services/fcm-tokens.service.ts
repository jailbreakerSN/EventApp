import crypto from "node:crypto";
import type { RegisterFcmTokenRequest, FcmToken } from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { NotFoundError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { BaseService } from "./base.service";

// ─── FCM Tokens Service (Phase C.1 — Web Push) ──────────────────────────────
// Registers, refreshes, and revokes FCM push destinations on the user doc.
// All mutations run inside `db.runTransaction` so concurrent
// register/revoke calls from a flaky browser session (permission flip,
// service-worker re-registration) cannot lose each other's writes.
//
// Security invariants:
//  - The raw token is ONLY persisted on the user doc (the FCM SDK needs it
//    to deliver). It is NEVER logged, emitted as a domain event payload,
//    or returned in an API response. Fingerprint-only (`sha256.slice(0,16)`)
//    is the one identifier the client sees.
//  - Firestore rules forbid the client from writing `fcmTokens` directly,
//    so this service is the sole write path (defense-in-depth with the API
//    layer's auth middleware).

const MAX_TOKENS_PER_USER = 10;

type StoredFcmTokens = FcmToken[] | string[] | undefined;

export function fingerprintToken(token: string): string {
  // 16 hex chars = 64 bits of collision space — plenty for a per-user cap
  // of 10 entries, and short enough to land in audit log details without
  // bloating the row.
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * Upgrade the legacy `string[]` shape to `FcmToken[]`. Legacy entries had no
 * platform or timestamps — we assume "web" (the only place legacy was written
 * from) and stamp `registeredAt`/`lastSeenAt` to `now` so the eviction-by-
 * lastSeenAt heuristic still has a valid timestamp to compare.
 */
function migrateLegacyTokens(stored: StoredFcmTokens, now: string): FcmToken[] {
  if (!stored || stored.length === 0) return [];
  // New shape — already migrated.
  if (typeof stored[0] === "object" && stored[0] !== null && "token" in stored[0]) {
    return stored as FcmToken[];
  }
  // Legacy shape — each entry is a raw token string.
  return (stored as string[]).map((token) => ({
    token,
    platform: "web" as const,
    registeredAt: now,
    lastSeenAt: now,
  }));
}

export class FcmTokensService extends BaseService {
  /**
   * Register a new token, or refresh the `lastSeenAt` timestamp of an
   * existing one. Caps the per-user list at `MAX_TOKENS_PER_USER` by
   * evicting the oldest entry (by `lastSeenAt`) when the cap is hit.
   */
  async register(
    user: AuthUser,
    input: RegisterFcmTokenRequest,
  ): Promise<{ status: "registered" | "refreshed"; tokenFingerprint: string; tokenCount: number }> {
    const fp = fingerprintToken(input.token);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const userRef = db.collection(COLLECTIONS.USERS).doc(user.uid);
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new NotFoundError("User", user.uid);

      const data = snap.data()!;
      const tokens = migrateLegacyTokens(data.fcmTokens as StoredFcmTokens, now);

      const existingIdx = tokens.findIndex((t) => t.token === input.token);
      let status: "registered" | "refreshed";
      let nextTokens: FcmToken[];

      if (existingIdx >= 0) {
        // Refresh: bump lastSeenAt only. Keep the original platform /
        // userAgent / registeredAt so we don't lose the history of when
        // this device first paired with the account.
        status = "refreshed";
        nextTokens = tokens.map((t, i) =>
          i === existingIdx ? { ...t, lastSeenAt: now } : t,
        );
      } else {
        status = "registered";
        const appended: FcmToken = {
          token: input.token,
          platform: input.platform,
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          registeredAt: now,
          lastSeenAt: now,
        };
        nextTokens = [...tokens, appended];
        if (nextTokens.length > MAX_TOKENS_PER_USER) {
          // Evict the oldest by lastSeenAt (ascending) until we're at cap.
          nextTokens = nextTokens
            .slice()
            .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
            .slice(nextTokens.length - MAX_TOKENS_PER_USER);
        }
      }

      tx.update(userRef, {
        fcmTokens: nextTokens,
        updatedAt: now,
      });

      return { status, tokenCount: nextTokens.length };
    });

    eventBus.emit("fcm.token_registered", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
      userId: user.uid,
      platform: input.platform,
      tokenFingerprint: fp,
      tokenCount: result.tokenCount,
      status: result.status,
    });

    return { status: result.status, tokenFingerprint: fp, tokenCount: result.tokenCount };
  }

  /**
   * Revoke a single token by its fingerprint. No-op if the fingerprint
   * doesn't match any stored token — revokes can originate from a stale
   * session, and surfacing 404 there would just confuse callers.
   */
  async revoke(
    user: AuthUser,
    tokenFingerprint: string,
  ): Promise<{ removed: boolean; tokenCount: number }> {
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const userRef = db.collection(COLLECTIONS.USERS).doc(user.uid);
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new NotFoundError("User", user.uid);

      const data = snap.data()!;
      const tokens = migrateLegacyTokens(data.fcmTokens as StoredFcmTokens, now);

      const nextTokens = tokens.filter((t) => fingerprintToken(t.token) !== tokenFingerprint);
      const removed = nextTokens.length < tokens.length;

      if (removed) {
        tx.update(userRef, {
          fcmTokens: nextTokens,
          updatedAt: now,
        });
      }

      return { removed, tokenCount: nextTokens.length };
    });

    eventBus.emit("fcm.token_revoked", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
      userId: user.uid,
      tokenFingerprint,
      removed: result.removed,
      tokenCount: result.tokenCount,
    });

    return result;
  }

  /**
   * Clear every token on the user doc. Called from the hard-sign-out path
   * (user switches account, explicitly logs out) to stop all push delivery
   * on untrusted devices.
   */
  async revokeAllForUser(user: AuthUser): Promise<{ removedCount: number }> {
    const now = new Date().toISOString();

    const removedCount = await db.runTransaction(async (tx) => {
      const userRef = db.collection(COLLECTIONS.USERS).doc(user.uid);
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new NotFoundError("User", user.uid);

      const data = snap.data()!;
      const tokens = migrateLegacyTokens(data.fcmTokens as StoredFcmTokens, now);
      const count = tokens.length;

      if (count > 0) {
        tx.update(userRef, {
          fcmTokens: [],
          updatedAt: now,
        });
      }

      return count;
    });

    eventBus.emit("fcm.tokens_cleared", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
      userId: user.uid,
      removedCount,
    });

    return { removedCount };
  }
}

export const fcmTokensService = new FcmTokensService();
