import { type AuditLogEntry } from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";

// ─── Actor display-name resolver (5-min in-memory cache) ────────────────────
//
// At write time we look up the acting user's `displayName ?? email` and
// inline it on the audit row as `actorDisplayName`. This makes the
// /admin/audit listing operator-readable without a client-side N+1 fan-out
// per page, and keeps historical rows queryable by human name at search
// time (future full-text upgrade).
//
// Caching rationale:
//   - Writes cluster around request bursts (publishing an event audits 3+
//     rows with the same actor). Looking up once per burst saves 2–5
//     Firestore reads.
//   - TTL is deliberately short (5 min) so a rename propagates without
//     restarting the process.
//   - Negative hits are NOT cached — a user who gets created mid-burst
//     should appear on the next audit write for the same actorId.

const ACTOR_NAME_TTL_MS = 5 * 60 * 1000;
const SYSTEM_ACTORS = new Set(["system", "cron", "trigger", ""]);

type CacheEntry = { value: string | null; cachedAt: number };
const actorNameCache = new Map<string, CacheEntry>();

async function resolveActorDisplayName(actorId: string): Promise<string | null> {
  // Sentinel "system"-class actors never correspond to a Firestore user doc.
  if (SYSTEM_ACTORS.has(actorId)) return null;

  const hit = actorNameCache.get(actorId);
  if (hit && Date.now() - hit.cachedAt < ACTOR_NAME_TTL_MS) {
    return hit.value;
  }

  try {
    const snap = await db.collection(COLLECTIONS.USERS).doc(actorId).get();
    if (!snap.exists) {
      // Don't cache misses — the user may be created moments later.
      return null;
    }
    const data = snap.data() as { displayName?: string; email?: string } | undefined;
    const name = data?.displayName?.trim() || data?.email?.trim() || null;
    actorNameCache.set(actorId, { value: name, cachedAt: Date.now() });
    return name;
  } catch {
    // Lookup failure MUST NOT block the audit write. Fall back to null;
    // the UI renders the truncated actorId as before.
    return null;
  }
}

/** Exposed for tests. Clears the cache. */
export function __clearActorNameCache(): void {
  actorNameCache.clear();
}

// ─── Service ────────────────────────────────────────────────────────────────

class AuditService {
  private get collection() {
    return db.collection(COLLECTIONS.AUDIT_LOGS);
  }

  /**
   * Write an audit log entry. Fire-and-forget — callers should not await.
   * Errors are caught and logged, never propagated.
   *
   * `actorDisplayName` is denormalized at write time unless the caller
   * explicitly passes one (rare — integration tests + backfill scripts).
   * Callers that already know the display name can short-circuit the
   * lookup by setting it directly.
   */
  async log(entry: Omit<AuditLogEntry, "id">): Promise<void> {
    try {
      const docRef = this.collection.doc();
      const resolvedName =
        entry.actorDisplayName !== undefined
          ? entry.actorDisplayName
          : await resolveActorDisplayName(entry.actorId);
      await docRef.set({
        id: docRef.id,
        ...entry,
        actorDisplayName: resolvedName,
      });
    } catch (err) {
      // Audit logging must never break the request flow
      process.stderr.write(`[AuditService] Failed to write audit log: ${err}\n`);
    }
  }
}

export const auditService = new AuditService();
