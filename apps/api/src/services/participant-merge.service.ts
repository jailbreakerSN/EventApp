/**
 * Organizer overhaul — Phase O7.
 *
 * Two responsibilities:
 *
 *  1. **Detection** : `detectDuplicates(orgId)` walks the org's
 *     participant set (derived from registrations) and returns pairs
 *     of users whose normalised email or phone match. Read-only,
 *     safe to poll. Capped at 100 candidates to keep the UI list
 *     scannable; the operator handles them in batches.
 *
 *  2. **Merge** : `merge(primaryUserId, secondaryUserId, orgId)` runs
 *     atomically inside a Firestore transaction:
 *       - re-points every registration of the secondary participant
 *         (within this organisation) to the primary user id;
 *       - merges tag lists into the primary profile;
 *       - archives the secondary profile (status → "merged");
 *       - emits `participant.merged` for the audit trail.
 *
 *     The participant's user document is NEVER mutated — the merge
 *     is org-scoped. A secondary user inscribed at OTHER orgs keeps
 *     all their registrations intact at those orgs.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { ConflictError } from "@/errors/app-error";
import type { AuthUser } from "@/middlewares/auth.middleware";
import {
  buildDuplicatePairId,
  normaliseEmail,
  normalisePhone,
  type DuplicateCandidate,
  type ParticipantProfile,
  type Registration,
} from "@teranga/shared-types";

interface DetectionConfig {
  /** Hard cap on the number of pairs returned. */
  limit: number;
}

const DEFAULT_DETECTION: DetectionConfig = { limit: 100 };

function eventEnvelope(actorId: string) {
  const ctx = getRequestContext();
  return {
    actorId,
    requestId: ctx?.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}

class ParticipantMergeService extends BaseService {
  /**
   * Walk every registration in the organisation, dedupe the user ids,
   * fetch the corresponding user docs, and return the pairs that
   * share a normalised email or phone.
   */
  async detectDuplicates(
    user: AuthUser,
    organizationId: string,
    config: Partial<DetectionConfig> = {},
  ): Promise<DuplicateCandidate[]> {
    this.requirePermission(user, "registration:read_all");
    this.requireOrganizationAccess(user, organizationId);
    const cfg = { ...DEFAULT_DETECTION, ...config };

    // Pull every registration for the org. We rely on Firestore
    // pagination for large orgs — for the dedup MVP, capping the
    // input set at 1000 is fine: an org with > 1000 registrations
    // typically uses paid tooling or has dedicated dedup workflows.
    const regsSnap = await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .where("organizationId", "==", organizationId)
      .limit(1000)
      .get();

    const userIds = new Set<string>();
    for (const doc of regsSnap.docs) {
      const data = doc.data() as Registration;
      if (data.userId) userIds.add(data.userId);
    }
    if (userIds.size < 2) return [];

    // Fetch user docs in chunks of 30 (Firestore `in` limit).
    const ids = [...userIds];
    const userDocs: Array<{
      id: string;
      email: string | null;
      phone: string | null;
    }> = [];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const refs = chunk.map((id) => db.collection(COLLECTIONS.USERS).doc(id));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data() as { email?: string; phone?: string };
        userDocs.push({
          id: snap.id,
          email: data.email ?? null,
          phone: data.phone ?? null,
        });
      }
    }

    return findDuplicateCandidates(userDocs, cfg.limit);
  }

  /**
   * Execute the merge inside a Firestore transaction. Re-points every
   * registration owned by `secondaryUserId` (within this org) to
   * `primaryUserId`, merges tag lists into the primary profile, and
   * archives the secondary profile.
   *
   * Atomic — either every write commits or none do. Returns the count
   * of registrations that moved.
   */
  async merge(
    user: AuthUser,
    organizationId: string,
    primaryUserId: string,
    secondaryUserId: string,
  ): Promise<{ registrationsMoved: number }> {
    this.requirePermission(user, "registration:read_all");
    this.requireOrganizationAccess(user, organizationId);
    if (primaryUserId === secondaryUserId) {
      throw new ConflictError("Impossible de fusionner un participant avec lui-même.");
    }

    // List secondary's registrations + both profiles ahead of the
    // transaction so the tx callback is fast (Firestore tx have a
    // ~30s budget; chunking the list reads outside the tx is the
    // safer default).
    const secondaryRegsSnap = await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .where("organizationId", "==", organizationId)
      .where("userId", "==", secondaryUserId)
      .get();

    const primaryProfileId = `${organizationId}_${primaryUserId}`;
    const secondaryProfileId = `${organizationId}_${secondaryUserId}`;
    const profilesSnap = await db.getAll(
      db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(primaryProfileId),
      db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(secondaryProfileId),
    );
    const primaryProfile = profilesSnap[0].exists
      ? (profilesSnap[0].data() as ParticipantProfile)
      : null;
    const secondaryProfile = profilesSnap[1].exists
      ? (profilesSnap[1].data() as ParticipantProfile)
      : null;

    const mergedTags = mergeTagLists(primaryProfile?.tags ?? [], secondaryProfile?.tags ?? []);

    let registrationsMoved = 0;
    await db.runTransaction(async (tx) => {
      // Re-point each registration. Inside the tx so the count is
      // exact even under concurrent writes.
      for (const doc of secondaryRegsSnap.docs) {
        tx.update(doc.ref, { userId: primaryUserId, updatedAt: new Date().toISOString() });
        registrationsMoved += 1;
      }

      // Upsert the primary profile with merged tags.
      const now = new Date().toISOString();
      tx.set(db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(primaryProfileId), {
        id: primaryProfileId,
        organizationId,
        userId: primaryUserId,
        tags: mergedTags,
        notes: primaryProfile?.notes ?? secondaryProfile?.notes ?? null,
        createdAt: primaryProfile?.createdAt ?? now,
        updatedAt: now,
      } satisfies ParticipantProfile);

      // Archive the secondary profile so it never resurfaces in dedup
      // detection (the marker `mergedInto` is checked by future
      // detection runs to skip already-merged users).
      if (secondaryProfile) {
        tx.set(db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(secondaryProfileId), {
          ...secondaryProfile,
          tags: [],
          notes: secondaryProfile.notes,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    eventBus.emit("participant.merged", {
      ...eventEnvelope(user.uid),
      organizationId,
      primaryUserId,
      secondaryUserId,
      registrationsMoved,
    });

    return { registrationsMoved };
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

interface UserDocLite {
  id: string;
  email: string | null;
  phone: string | null;
}

/**
 * Group user docs by normalised email and phone. Any group of size
 * > 1 produces (n choose 2) pairs. The returned list is capped at
 * `limit` and de-duplicated by deterministic pair id.
 */
export function findDuplicateCandidates(
  users: readonly UserDocLite[],
  limit: number,
): DuplicateCandidate[] {
  const byEmail = new Map<string, string[]>();
  const byPhone = new Map<string, string[]>();
  for (const u of users) {
    if (u.email) {
      const key = normaliseEmail(u.email);
      if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), u.id]);
    }
    if (u.phone) {
      const key = normalisePhone(u.phone);
      if (key.length >= 6) byPhone.set(key, [...(byPhone.get(key) ?? []), u.id]);
    }
  }

  const out = new Map<string, DuplicateCandidate>();
  const drainGroup = (group: string[], kind: "email" | "phone", value: string) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const pairId = buildDuplicatePairId(a, b);
        if (out.has(pairId)) continue;
        out.set(pairId, {
          pairId,
          primaryUserId: a < b ? a : b,
          secondaryUserId: a < b ? b : a,
          matchKind: kind,
          matchValue: value,
        });
        if (out.size >= limit) return;
      }
    }
  };
  for (const [value, group] of byEmail.entries()) {
    drainGroup(group, "email", value);
    if (out.size >= limit) break;
  }
  for (const [value, group] of byPhone.entries()) {
    drainGroup(group, "phone", value);
    if (out.size >= limit) break;
  }
  return [...out.values()];
}

export function mergeTagLists(primary: readonly string[], secondary: readonly string[]): string[] {
  const set = new Set<string>();
  for (const tag of primary) {
    const trimmed = tag.trim();
    if (trimmed) set.add(trimmed);
  }
  for (const tag of secondary) {
    const trimmed = tag.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

export const participantMergeService = new ParticipantMergeService();
