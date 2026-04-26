/**
 * Organizer overhaul — Phase O2.
 *
 * Aggregates the "what needs me today?" signals for the organizer
 * inbox landing (`/v1/me/inbox`). Mirror of the admin inbox in
 * `admin.service.ts::getInboxSignals` — same shape, organisation-
 * scoped instead of platform-scoped.
 *
 * Design constraints:
 *  - FAST — every count runs in parallel via `Promise.all`, target
 *    < 1 s end-to-end. Fits inside the 60 s auto-refresh budget on
 *    the frontend without taxing Firestore reads.
 *  - READ-ONLY — no mutations, safe to poll. We only count, never
 *    fetch full docs.
 *  - GRACEFULLY DEGRADED — per-section failures are swallowed
 *    (returning 0) so a single broken collection never tanks the
 *    whole inbox response.
 *  - ORG-SCOPED — every Firestore query carries
 *    `where("organizationId", "==", user.organizationId)`. The
 *    `requireOrganizationAccess` guard at the top is defence-in-depth
 *    against a bug that mis-filters: the worker user must already
 *    own the org we're aggregating for.
 *  - NO LIVE-EVENT BLOCKING — the signal set excludes anything that
 *    would re-trigger expensive aggregations during a check-in
 *    storm (CLAUDE.md grace-period rule).
 *
 * The 6-category taxonomy is documented in
 * `docs/organizer-overhaul/PLAN.md` §5 phase O2.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { PLAN_LIMITS, PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";
import type { AuthUser } from "@/middlewares/auth.middleware";

export type OrganizerSignalCategory =
  | "urgent"
  | "today"
  | "week"
  | "growth"
  | "moderation"
  | "team";

export type OrganizerSignalSeverity = "info" | "warning" | "critical";

export interface OrganizerInboxSignal {
  id: string;
  category: OrganizerSignalCategory;
  severity: OrganizerSignalSeverity;
  title: string;
  description: string;
  count: number;
  /** Deep link into the pre-filtered list / target page. */
  href: string;
}

export interface OrganizerInboxResponse {
  signals: OrganizerInboxSignal[];
  computedAt: string;
}

class OrganizerInboxService extends BaseService {
  /**
   * Aggregate the inbox signals for the organizer of the caller's
   * organization. Returns a flat list of (category, signal) tuples;
   * the frontend bins them into the 6 sections. We DON'T return the
   * empty sections — the UI shows a "Tout va bien" success state
   * when the array is empty.
   */
  async getInboxSignals(user: AuthUser): Promise<OrganizerInboxResponse> {
    // Only organizers (and co-organizers, super_admins) can pull this.
    // Permission gating mirrors the sidebar nav: `event:read` is the
    // shared baseline for the organizer shell.
    this.requirePermission(user, "event:read");

    const orgId = user.organizationId;
    if (!orgId) {
      // Caller is signed-in but has no org membership (rare — e.g. a
      // newly-promoted super_admin who lost the seed org). Return an
      // empty inbox rather than 500.
      return { signals: [], computedAt: new Date().toISOString() };
    }
    this.requireOrganizationAccess(user, orgId);

    const safeCount = async (label: string, fn: () => Promise<number>): Promise<number> => {
      try {
        return await fn();
      } catch (err) {
        process.stderr.write(
          `[organizer-inbox] ${label} count failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return 0;
      }
    };

    const now = new Date();
    const nowIso = now.toISOString();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      // urgent
      paymentsFailedRecent,
      eventsPublishedNoVenueJ7,
      // today
      eventsLiveNow,
      // week
      eventsPublishingDue7d,
      paymentsPending,
      // moderation
      speakersUnconfirmed,
      // team
      invitesPending,
      invitesExpired,
      // growth (computed below — needs org doc)
      orgDoc,
      activeEventsCount,
    ] = await Promise.all([
      safeCount("payments.failed_7d", async () => {
        const snap = await db
          .collection(COLLECTIONS.PAYMENTS)
          .where("organizationId", "==", orgId)
          .where("status", "==", "failed")
          .where("createdAt", ">=", sevenDaysAgo)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("events.published_no_venue_j7", async () => {
        // Count events that are published, start within the next 7
        // days, and have no venueId set. Firestore doesn't support
        // OR queries cheaply, so we do the venue=null filter via a
        // compound where("venueId", "==", null). Indexed via the
        // composite (organizationId, status, startDate) — see
        // firestore.indexes.json.
        const snap = await db
          .collection(COLLECTIONS.EVENTS)
          .where("organizationId", "==", orgId)
          .where("status", "==", "published")
          .where("venueId", "==", null)
          .where("startDate", "<=", sevenDaysFromNow)
          .where("startDate", ">=", nowIso)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("events.live_now", async () => {
        // Live = startDate <= now <= endDate. Firestore can only
        // range on one field per query, so we narrow by
        // status+startDate and let the operator drill into the
        // filtered list. The signal title says "en cours" so a small
        // false-positive (started but not yet over) is acceptable.
        const snap = await db
          .collection(COLLECTIONS.EVENTS)
          .where("organizationId", "==", orgId)
          .where("status", "==", "published")
          .where("startDate", "<=", nowIso)
          .where("endDate", ">=", nowIso)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("events.publish_due_7d", async () => {
        // Drafts whose start is within 7 days — likely to be the
        // "I forgot to publish" failure mode.
        const snap = await db
          .collection(COLLECTIONS.EVENTS)
          .where("organizationId", "==", orgId)
          .where("status", "==", "draft")
          .where("startDate", "<=", sevenDaysFromNow)
          .where("startDate", ">=", nowIso)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("payments.pending_24h", async () => {
        const snap = await db
          .collection(COLLECTIONS.PAYMENTS)
          .where("organizationId", "==", orgId)
          .where("status", "==", "pending")
          .where("createdAt", "<=", oneDayFromNow)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("speakers.unconfirmed", async () => {
        const snap = await db
          .collection(COLLECTIONS.SPEAKERS)
          .where("organizationId", "==", orgId)
          .where("isConfirmed", "==", false)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("invites.pending", async () => {
        const snap = await db
          .collection(COLLECTIONS.INVITES)
          .where("organizationId", "==", orgId)
          .where("status", "==", "pending")
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("invites.expired", async () => {
        const snap = await db
          .collection(COLLECTIONS.INVITES)
          .where("organizationId", "==", orgId)
          .where("status", "==", "expired")
          .count()
          .get();
        return snap.data().count;
      }),
      // growth — fetch the org doc + active event count to drive plan
      // usage signals (events near limit / members near limit). Two
      // parallel reads instead of going through subscriptionService
      // because we want to keep the inbox query budget tight; the
      // org doc is already a hot Firestore key.
      (async () => {
        try {
          const snap = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
          return snap.exists ? snap.data() : null;
        } catch (err) {
          process.stderr.write(
            `[organizer-inbox] orgDoc fetch failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          return null;
        }
      })(),
      safeCount("events.active", async () => {
        // "Active" = not archived / cancelled / completed. Mirrors
        // the count used by `subscription.service.getUsage`.
        const snap = await db
          .collection(COLLECTIONS.EVENTS)
          .where("organizationId", "==", orgId)
          .where("status", "in", ["draft", "published"])
          .count()
          .get();
        return snap.data().count;
      }),
    ]);

    const signals: OrganizerInboxSignal[] = [];

    // ─── Urgent ─────────────────────────────────────────────────────
    if (paymentsFailedRecent > 0) {
      signals.push({
        id: "payments.failed_7d",
        category: "urgent",
        severity: "critical",
        title: `${paymentsFailedRecent} paiement${paymentsFailedRecent > 1 ? "s" : ""} échoué${paymentsFailedRecent > 1 ? "s" : ""} cette semaine`,
        description: "Relancer les participants ou contacter le provider.",
        count: paymentsFailedRecent,
        href: "/finance?status=failed",
      });
    }
    if (eventsPublishedNoVenueJ7 > 0) {
      signals.push({
        id: "events.published_no_venue_j7",
        category: "urgent",
        severity: "warning",
        title: `${eventsPublishedNoVenueJ7} événement${eventsPublishedNoVenueJ7 > 1 ? "s" : ""} sans lieu confirmé à J-7`,
        description: "Logistique critique — ajouter un lieu avant l'envoi des rappels.",
        count: eventsPublishedNoVenueJ7,
        href: "/events?status=published&missingVenue=true",
      });
    }

    // ─── Aujourd'hui ────────────────────────────────────────────────
    if (eventsLiveNow > 0) {
      signals.push({
        id: "events.live_now",
        category: "today",
        severity: "info",
        title: `${eventsLiveNow} événement${eventsLiveNow > 1 ? "s" : ""} en cours`,
        description: "Surveiller le check-in et la salle. Cliquer pour la vue live.",
        count: eventsLiveNow,
        href: "/events?status=published&live=true",
      });
    }

    // ─── Cette semaine ──────────────────────────────────────────────
    if (eventsPublishingDue7d > 0) {
      signals.push({
        id: "events.publish_due_7d",
        category: "week",
        severity: "warning",
        title: `${eventsPublishingDue7d} événement${eventsPublishingDue7d > 1 ? "s" : ""} en brouillon à publier sous 7 jours`,
        description: "La date approche — vérifier les détails et publier.",
        count: eventsPublishingDue7d,
        href: "/events?status=draft",
      });
    }
    if (paymentsPending > 0) {
      signals.push({
        id: "payments.pending",
        category: "week",
        severity: "info",
        title: `${paymentsPending} paiement${paymentsPending > 1 ? "s" : ""} en attente`,
        description: "Surveiller la confirmation provider sous 24h.",
        count: paymentsPending,
        href: "/finance?status=pending",
      });
    }

    // ─── Croissance (plan usage near limit) ─────────────────────────
    if (orgDoc) {
      const plan = (orgDoc.plan as keyof typeof PLAN_LIMITS) ?? "free";
      const fallback = PLAN_LIMITS[plan];
      const effectiveLimits =
        (orgDoc.effectiveLimits as { maxEvents: number; maxMembers: number } | undefined) ?? null;

      const maxEvents = effectiveLimits
        ? effectiveLimits.maxEvents === PLAN_LIMIT_UNLIMITED
          ? Infinity
          : effectiveLimits.maxEvents
        : fallback.maxEvents;
      const maxMembers = effectiveLimits
        ? effectiveLimits.maxMembers === PLAN_LIMIT_UNLIMITED
          ? Infinity
          : effectiveLimits.maxMembers
        : fallback.maxMembers;

      const memberCount = Array.isArray(orgDoc.memberIds) ? orgDoc.memberIds.length : 0;

      const eventsPercent =
        maxEvents === Infinity ? 0 : Math.floor((activeEventsCount / maxEvents) * 100);
      const membersPercent =
        maxMembers === Infinity ? 0 : Math.floor((memberCount / maxMembers) * 100);

      if (eventsPercent >= 80) {
        signals.push({
          id: "growth.events_near_limit",
          category: "growth",
          severity: eventsPercent >= 100 ? "critical" : "warning",
          title:
            eventsPercent >= 100
              ? `Limite d'événements atteinte (${activeEventsCount}/${maxEvents})`
              : `Limite d'événements proche (${activeEventsCount}/${maxEvents}, ${eventsPercent} %)`,
          description: "Passer à un plan supérieur pour continuer à créer des événements.",
          count: activeEventsCount,
          href: "/organization/billing",
        });
      }
      if (membersPercent >= 80) {
        signals.push({
          id: "growth.members_near_limit",
          category: "growth",
          severity: membersPercent >= 100 ? "critical" : "warning",
          title:
            membersPercent >= 100
              ? `Limite de membres atteinte (${memberCount}/${maxMembers})`
              : `Limite de membres proche (${memberCount}/${maxMembers}, ${membersPercent} %)`,
          description: "Inviter plus de membres demande un upgrade de plan.",
          count: memberCount,
          href: "/organization/billing",
        });
      }
    }

    // ─── Modération ─────────────────────────────────────────────────
    if (speakersUnconfirmed > 0) {
      signals.push({
        id: "speakers.unconfirmed",
        category: "moderation",
        severity: "info",
        title: `${speakersUnconfirmed} intervenant${speakersUnconfirmed > 1 ? "s" : ""} à valider`,
        description: "Relire les bios et valider la participation.",
        count: speakersUnconfirmed,
        href: "/events?tab=speakers&speakerStatus=unconfirmed",
      });
    }

    // ─── Équipe ─────────────────────────────────────────────────────
    if (invitesPending > 0) {
      signals.push({
        id: "invites.pending",
        category: "team",
        severity: "info",
        title: `${invitesPending} invitation${invitesPending > 1 ? "s" : ""} en attente`,
        description: "Relancer ou laisser expirer.",
        count: invitesPending,
        href: "/organization?tab=invites&status=pending",
      });
    }
    if (invitesExpired > 0) {
      signals.push({
        id: "invites.expired",
        category: "team",
        severity: "info",
        title: `${invitesExpired} invitation${invitesExpired > 1 ? "s" : ""} expirée${invitesExpired > 1 ? "s" : ""}`,
        description: "À nettoyer ou à relancer selon le contexte.",
        count: invitesExpired,
        href: "/organization?tab=invites&status=expired",
      });
    }

    return { signals, computedAt: new Date().toISOString() };
  }
}

export const organizerInboxService = new OrganizerInboxService();
