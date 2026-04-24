import { db, COLLECTIONS } from "@/config/firebase";
import { type AuthUser } from "@/middlewares/auth.middleware";

/**
 * T2.4 — Read-only announcements service.
 *
 * Separation from the admin-side write path (in admin.routes.ts) is
 * deliberate: clients see only active, unexpired banners scoped to
 * their audience, with admin-only metadata (`createdBy`) stripped
 * from the wire. The admin surface reads / writes directly via the
 * Admin SDK — a different trust boundary.
 */

export interface PublicAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  audience: "all" | "organizers" | "participants";
  publishedAt: string;
  expiresAt?: string;
  active: boolean;
}

interface StoredAnnouncement extends PublicAnnouncement {
  /** Admin-only — NEVER returned to the client. */
  createdBy: string;
}

class AnnouncementsService {
  /**
   * Return all active + unexpired announcements relevant to the
   * caller's audience. Derives the audience from the caller's role
   * set (participants → "participants", everything else →
   * "organizers"). Sorted newest-first, de-duped by id.
   */
  async listActiveForUser(user: AuthUser): Promise<PublicAnnouncement[]> {
    const nowIso = new Date().toISOString();
    const audience: "organizers" | "participants" = user.roles.some((r) =>
      ["participant"].includes(r),
    )
      ? "participants"
      : "organizers";

    // Two parallel queries: blanket audience + role-targeted. Keep
    // them explicit so the composite index stays trivial.
    const [allSnap, targetedSnap] = await Promise.all([
      db
        .collection(COLLECTIONS.ANNOUNCEMENTS)
        .where("active", "==", true)
        .where("audience", "==", "all")
        .orderBy("publishedAt", "desc")
        .limit(20)
        .get(),
      db
        .collection(COLLECTIONS.ANNOUNCEMENTS)
        .where("active", "==", true)
        .where("audience", "==", audience)
        .orderBy("publishedAt", "desc")
        .limit(20)
        .get(),
    ]);

    // In-memory filter for `expiresAt > now` — Firestore can't
    // combine two inequality filters across fields. Bounded doc
    // count (≤ 40) makes this trivially cheap.
    const merged: PublicAnnouncement[] = [];
    const seen = new Set<string>();
    for (const snap of [allSnap, targetedSnap]) {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const raw = { id: doc.id, ...doc.data() } as StoredAnnouncement;
        if (raw.expiresAt && raw.expiresAt <= nowIso) continue;
        // Security-review P2 — strip `createdBy` from the wire. It's
        // an internal admin uid with no business being exposed to
        // arbitrary authenticated users.
        const { createdBy: _createdBy, ...publicShape } = raw;
        void _createdBy;
        merged.push(publicShape);
      }
    }

    merged.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return merged;
  }
}

export const announcementsService = new AnnouncementsService();
