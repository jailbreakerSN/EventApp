import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";
import { dispatchInternalChunked, type InternalDispatchRecipient } from "../utils/internal-dispatch";

// ─── Subscription reminder scheduler (Phase 2.3) ───────────────────────────
//
// Runs daily at 09:00 Africa/Dakar. For every active paid subscription:
//
//   • Emits `subscription.expiring_soon` exactly once when the current
//     period ends in exactly 7 days. Idempotency key includes the
//     renewal date so a resubscribe next month fires a fresh email.
//     Mandatory billing email (userOptOutAllowed=false in catalog).
//
//   • Emits `subscription.approaching_limit` once per dimension per org
//     per day when usage crosses 80% of any plan cap (events, members,
//     participants). Dedup key includes the date-stamp so the next
//     day's run sends again if usage is still elevated — the
//     dispatcher's persistent dedup log catches within-day retries.
//
// Usage math:
//   events        → count of events in status != archived/cancelled
//   members       → memberIds.length on the org doc
//   participants  → max registeredCount across the org's active events
//
// Plan caps mirror the legacy PLAN_LIMITS table (shared-types) via a
// hard-coded local map so this Function bundle stays lean — importing
// the whole `@teranga/shared-types` barrel (with Zod schemas) into a
// scheduled function is overkill for a three-value lookup.

interface PlanCaps {
  maxEvents: number;
  maxMembers: number;
  maxParticipantsPerEvent: number;
}

// Kept in sync with PLAN_LIMITS in packages/shared-types/src/
// organization.types.ts — if those caps change, update here too. The CI
// linter does NOT enforce parity (intentional — see header). Trade-off:
// a slightly-stale local copy is a minor warning, whereas importing the
// whole shared-types bundle in a Function is a fat-binary cost.
const PLAN_CAPS: Record<string, PlanCaps> = {
  free: { maxEvents: 3, maxMembers: 1, maxParticipantsPerEvent: 50 },
  starter: { maxEvents: 10, maxMembers: 3, maxParticipantsPerEvent: 200 },
  pro: { maxEvents: Number.POSITIVE_INFINITY, maxMembers: 50, maxParticipantsPerEvent: 2000 },
  enterprise: {
    maxEvents: Number.POSITIVE_INFINITY,
    maxMembers: Number.POSITIVE_INFINITY,
    maxParticipantsPerEvent: Number.POSITIVE_INFINITY,
  },
};

const EIGHTY_PERCENT = 0.8;

/** Format a numeric plan cap for log output. Infinity → "∞". */
function capForLog(n: number): string {
  return Number.isFinite(n) ? String(n) : "∞";
}

/** Format an XOF integer as "29 900 FCFA". */
function formatXof(amount: number): string {
  try {
    return new Intl.NumberFormat("fr-SN", {
      style: "currency",
      currency: "XOF",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} XOF`;
  }
}

/** Difference in whole days (positive = future). */
function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

export const sendSubscriptionReminders = onSchedule(
  {
    schedule: "0 9 * * *", // daily 09:00
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const today = new Date();
    const todayIso = today.toISOString();
    const dayStamp = todayIso.slice(0, 10); // YYYY-MM-DD

    try {
      const subsSnap = await db
        .collection(COLLECTIONS.SUBSCRIPTIONS)
        .where("status", "==", "active")
        .get();

      if (subsSnap.empty) {
        logger.info("subscription reminders: no active subscriptions");
        return;
      }

      for (const subDoc of subsSnap.docs) {
        const sub = subDoc.data();
        const orgId: string = sub.organizationId;
        const plan: string = sub.plan ?? "free";
        if (plan === "free") continue; // free never renews, never warns

        try {
          // ── 7-day expiry warning ─────────────────────────────────────
          if (sub.currentPeriodEnd) {
            const days = daysBetween(sub.currentPeriodEnd, todayIso);
            if (days === 7) {
              const recipients = await resolveBillingRecipients(orgId);
              if (recipients.length > 0) {
                const result = await dispatchInternalChunked({
                  key: "subscription.expiring_soon",
                  recipients,
                  params: {
                    planKey: plan,
                    amount: formatXof(sub.priceXof ?? 0),
                    renewalAt: sub.currentPeriodEnd,
                    daysUntilRenewal: 7,
                  },
                  // Renewal-date-stamped so a subsequent resubscribe
                  // (different renewal date) fires a fresh email.
                  idempotencyKey: `subscription-expiring-soon/${orgId}/${String(
                    sub.currentPeriodEnd,
                  ).slice(0, 10)}`,
                });
                logger.info("subscription.expiring_soon dispatched", {
                  orgId,
                  plan,
                  renewalAt: sub.currentPeriodEnd,
                  sent: result.sent,
                  failed: result.failed,
                });
              }
            }
          }

          // ── 80% usage warning per dimension ──────────────────────────
          const caps = PLAN_CAPS[plan] ?? PLAN_CAPS.free!;
          const usage = await computeUsage(orgId);
          for (const dimension of ["events", "members", "participants"] as const) {
            const cap =
              dimension === "events"
                ? caps.maxEvents
                : dimension === "members"
                  ? caps.maxMembers
                  : caps.maxParticipantsPerEvent;
            if (!Number.isFinite(cap)) continue; // unlimited → no warning
            const current = usage[dimension];
            const percent = current / cap;
            if (percent < EIGHTY_PERCENT) continue;
            if (current > cap) continue; // already over → a different alert path handles this

            const recipients = await resolveBillingRecipients(orgId);
            if (recipients.length === 0) continue;

            const result = await dispatchInternalChunked({
              key: "subscription.approaching_limit",
              recipients,
              params: {
                planKey: plan,
                dimension,
                current: String(current),
                limit: capForLog(cap),
                percent: String(Math.round(percent * 100)),
              },
              idempotencyKey: `subscription-approaching-limit/${orgId}/${dimension}/${dayStamp}`,
            });
            logger.info("subscription.approaching_limit dispatched", {
              orgId,
              plan,
              dimension,
              current,
              limit: capForLog(cap),
              percent: Math.round(percent * 100),
              sent: result.sent,
              failed: result.failed,
            });
          }
        } catch (err) {
          logger.error(`subscription reminders failed for org ${orgId}`, err);
        }
      }
    } catch (err) {
      logger.error("subscription reminders: top-level failure", err);
    }
  },
);

// ─── Helpers ──────────────────────────────────────────────────────────────

async function resolveBillingRecipients(
  organizationId: string,
): Promise<InternalDispatchRecipient[]> {
  const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(organizationId).get();
  if (!orgDoc.exists) return [];
  const org = orgDoc.data()!;
  const ids = new Set<string>([org.ownerId, ...((org.memberIds as string[]) ?? [])]);
  const recipients: InternalDispatchRecipient[] = [];
  const userDocs = await db.getAll(
    ...[...ids].map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)),
  );
  for (const u of userDocs) {
    if (!u.exists) continue;
    const data = u.data()!;
    if (!data.email) continue;
    const lang = data.preferredLanguage;
    const preferredLocale = lang === "en" || lang === "wo" ? (lang as "en" | "wo") : "fr";
    recipients.push({ userId: u.id, email: data.email, preferredLocale });
  }
  return recipients;
}

async function computeUsage(
  organizationId: string,
): Promise<{ events: number; members: number; participants: number }> {
  const [eventsSnap, orgDoc] = await Promise.all([
    db
      .collection(COLLECTIONS.EVENTS)
      .where("organizationId", "==", organizationId)
      .where("status", "in", ["draft", "published"])
      .get(),
    db.collection(COLLECTIONS.ORGANIZATIONS).doc(organizationId).get(),
  ]);
  const events = eventsSnap.size;
  const org = orgDoc.data();
  const members = org ? 1 + ((org.memberIds as string[] | undefined)?.length ?? 0) : 0;
  let participants = 0;
  for (const e of eventsSnap.docs) {
    const count = (e.data().registeredCount as number) ?? 0;
    if (count > participants) participants = count;
  }
  return { events, members, participants };
}
