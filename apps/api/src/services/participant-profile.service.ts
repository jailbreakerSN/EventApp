/**
 * Organizer overhaul — Phase O7.
 *
 * Manages the org-scoped participant profile (tags + organizer-only
 * notes). Storage layer uses a deterministic doc id
 * `${organizationId}_${userId}` so a get-by-key is O(1) and Firestore
 * rules can scope writes per organisation.
 *
 * Authorization: every method requires `registration:read_all` and
 * `requireOrganizationAccess`. The participant themselves never reads
 * their own profile — the notes field would be a privacy leak.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  ParticipantProfile,
  UpdateParticipantProfileDto,
  BulkTagRegistrationsDto,
} from "@teranga/shared-types";

function eventEnvelope(actorId: string) {
  const ctx = getRequestContext();
  return {
    actorId,
    requestId: ctx?.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}

class ParticipantProfileService extends BaseService {
  private docId(organizationId: string, userId: string): string {
    return `${organizationId}_${userId}`;
  }

  /**
   * Read the profile for one (org, participant) pair. Returns null
   * when no profile has been created yet — callers treat the absence
   * as "no tags, no notes" rather than synthesising an empty doc.
   */
  async get(
    user: AuthUser,
    organizationId: string,
    userId: string,
  ): Promise<ParticipantProfile | null> {
    this.requirePermission(user, "registration:read_all");
    this.requireOrganizationAccess(user, organizationId);

    const id = this.docId(organizationId, userId);
    const snap = await db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(id).get();
    if (!snap.exists) return null;
    return snap.data() as ParticipantProfile;
  }

  /**
   * Bulk-fetch profiles for a set of user ids in one organisation.
   * Used by the cross-event participants directory to render tag
   * pills without N+1 lookups. Capped at 100 per call to stay under
   * Firestore's `in` query limit; callers chunk if needed.
   */
  async getMany(
    user: AuthUser,
    organizationId: string,
    userIds: string[],
  ): Promise<Map<string, ParticipantProfile>> {
    this.requirePermission(user, "registration:read_all");
    this.requireOrganizationAccess(user, organizationId);

    const out = new Map<string, ParticipantProfile>();
    if (userIds.length === 0) return out;

    const ids = userIds.slice(0, 100).map((uid) => this.docId(organizationId, uid));
    const refs = ids.map((id) => db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() as ParticipantProfile;
      out.set(data.userId, data);
    }
    return out;
  }

  /**
   * Idempotent upsert. Computes the next tag set / notes value, writes
   * if and only if the diff is non-empty, and emits a domain event
   * carrying the resulting tag list (notes value is intentionally
   * scrubbed from the event — only the `notesChanged` boolean travels).
   */
  async update(
    user: AuthUser,
    organizationId: string,
    userId: string,
    dto: UpdateParticipantProfileDto,
  ): Promise<ParticipantProfile> {
    this.requirePermission(user, "registration:read_all");
    this.requireOrganizationAccess(user, organizationId);

    const id = this.docId(organizationId, userId);
    const ref = db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(id);

    // Read-then-write must be atomic. Two organizers editing the same
    // participant's tags would otherwise race — the second writer's
    // tag list would silently overwrite the first's. The transaction
    // also serialises notes updates so `notesChanged` stays accurate.
    const { next, notesChanged, idempotent, existing } = await db.runTransaction(
      async (tx) => {
        const snap = await tx.get(ref);
        const existingDoc = snap.exists ? (snap.data() as ParticipantProfile) : null;
        const now = new Date().toISOString();

        const nextTags = dto.tags
          ? dedupeAndSortTags(dto.tags)
          : (existingDoc?.tags ?? []);
        const nextNotes =
          dto.notes !== undefined ? dto.notes : (existingDoc?.notes ?? null);
        const notesChangedInner =
          dto.notes !== undefined && dto.notes !== existingDoc?.notes;
        const tagsChanged =
          dto.tags !== undefined &&
          JSON.stringify(nextTags) !== JSON.stringify(existingDoc?.tags ?? []);

        if (!notesChangedInner && !tagsChanged && existingDoc) {
          return {
            next: existingDoc,
            notesChanged: false,
            idempotent: true,
            existing: existingDoc,
          };
        }

        const nextDoc: ParticipantProfile = {
          id,
          organizationId,
          userId,
          tags: nextTags,
          notes: nextNotes,
          createdAt: existingDoc?.createdAt ?? now,
          updatedAt: now,
        };
        tx.set(ref, nextDoc);
        return {
          next: nextDoc,
          notesChanged: notesChangedInner,
          idempotent: false,
          existing: existingDoc,
        };
      },
    );

    if (idempotent) return existing!;

    eventBus.emit("participant_profile.updated", {
      ...eventEnvelope(user.uid),
      organizationId,
      userId,
      tags: next.tags,
      notesChanged,
    });

    return next;
  }

  /**
   * Bulk apply add/remove tag deltas across many participants.
   * Resolves one (organizationId, userId) per registration via the
   * registration repo (caller hands us registrationIds).
   */
  async bulkTagFromRegistrations(
    user: AuthUser,
    organizationId: string,
    dto: BulkTagRegistrationsDto,
  ): Promise<{ applied: number }> {
    this.requirePermission(user, "registration:read_all");
    this.requireOrganizationAccess(user, organizationId);

    if (dto.addTags.length === 0 && dto.removeTags.length === 0) {
      return { applied: 0 };
    }

    // Resolve registration → userId in one shot via getAll.
    const regRefs = dto.registrationIds.map((id) =>
      db.collection(COLLECTIONS.REGISTRATIONS).doc(id),
    );
    const regSnaps = regRefs.length > 0 ? await db.getAll(...regRefs) : [];
    const userIds = new Set<string>();
    for (const snap of regSnaps) {
      if (!snap.exists) continue;
      const data = snap.data() as { userId?: string; organizationId?: string };
      if (data.userId && data.organizationId === organizationId) {
        userIds.add(data.userId);
      }
    }

    let applied = 0;
    const addSet = new Set(dto.addTags);
    const removeSet = new Set(dto.removeTags);

    // Each per-participant read-modify-write must run inside its own
    // transaction so concurrent bulk-tag jobs (or a concurrent single
    // update via `update()`) cannot lose a tag delta. We loop
    // sequentially: the operator action is rate-limited and bounded
    // to ≤ 100 participants by the route Zod schema, so a serial
    // tx-per-row is well within Firestore's per-tx budget.
    for (const userId of userIds) {
      const id = this.docId(organizationId, userId);
      const ref = db.collection(COLLECTIONS.PARTICIPANT_PROFILES).doc(id);

      const { next, applied: appliedThisRow } = await db.runTransaction(
        async (tx) => {
          const snap = await tx.get(ref);
          const existing = snap.exists ? (snap.data() as ParticipantProfile) : null;
          const merged = applyTagDelta(existing?.tags ?? [], addSet, removeSet);
          if (existing && JSON.stringify(merged) === JSON.stringify(existing.tags ?? [])) {
            return { next: null, applied: false }; // no-op for this participant
          }
          const now = new Date().toISOString();
          const nextDoc: ParticipantProfile = {
            id,
            organizationId,
            userId,
            tags: merged,
            notes: existing?.notes ?? null,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          tx.set(ref, nextDoc);
          return { next: nextDoc, applied: true };
        },
      );

      if (!appliedThisRow || !next) continue;

      eventBus.emit("participant_profile.updated", {
        ...eventEnvelope(user.uid),
        organizationId,
        userId,
        tags: next.tags,
        notesChanged: false,
      });
      applied += 1;
    }

    return { applied };
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

export function dedupeAndSortTags(tags: readonly string[]): string[] {
  const set = new Set<string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) continue;
    set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

export function applyTagDelta(
  current: readonly string[],
  add: ReadonlySet<string>,
  remove: ReadonlySet<string>,
): string[] {
  const set = new Set<string>(current);
  for (const tag of add) set.add(tag.trim());
  for (const tag of remove) set.delete(tag.trim());
  return dedupeAndSortTags([...set]);
}

export const participantProfileService = new ParticipantProfileService();
