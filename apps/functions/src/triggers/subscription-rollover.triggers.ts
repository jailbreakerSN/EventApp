import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";
import {
  PLAN_LIMITS,
  PLAN_DISPLAY,
  PLAN_LIMIT_UNLIMITED,
  type OrganizationPlan,
  type Subscription,
  type Plan,
  type ScheduledChange,
  type Organization,
} from "@teranga/shared-types";

// ─── Subscription Rollover (Phase 4c) ────────────────────────────────────────
//
// Applies scheduled plan changes whose `effectiveAt` has passed. The
// subscription.service.downgrade() / .cancel() paths queue these when a
// paid period is still in force ("prepaid period honoring"); this job is
// the worker that eventually flips the plan.
//
// Design:
//  - Runs daily at 02:00 Africa/Dakar. A 24h max gap between `effectiveAt`
//    and the actual flip is acceptable at our scale and avoids charging
//    for a per-minute scheduler.
//  - Each subscription is rolled over in its own Firestore transaction.
//    Partial failures don't block the rest.
//  - Idempotent: clears `scheduledChange` on success; re-running is a no-op.
//  - Dunning subs (`status === "past_due"`) are skipped — their lifecycle
//    is owned by payment-failure flows, not this job.
//  - Mirrors apps/api/src/services/subscription-rollover.ts — Firebase
//    Functions can't easily import the API layer, so the logic is
//    duplicated here intentionally. Both share shared-types to stay in
//    sync on the data model.

function storedToRuntime(n: number): number {
  return n === PLAN_LIMIT_UNLIMITED ? Infinity : n;
}

function runtimeToStored(n: number): number {
  return Number.isFinite(n) ? n : PLAN_LIMIT_UNLIMITED;
}

export const applySubscriptionRollovers = onSchedule(
  {
    // 02:00 Africa/Dakar every day — after midnight period-end boundaries
    // but before business hours so any denormalization hiccup surfaces
    // before users log in.
    schedule: "0 2 * * *",
    region: "europe-west1",
    timeZone: "Africa/Dakar",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const now = new Date();
    const nowIso = now.toISOString();

    const candidates = await db
      .collection(COLLECTIONS.SUBSCRIPTIONS)
      .where("scheduledChange.effectiveAt", "<=", nowIso)
      .get();

    if (candidates.empty) {
      logger.info("No scheduled subscription changes to apply", { nowIso });
      return;
    }

    // Preload the plans catalog once.
    const plansSnap = await db.collection(COLLECTIONS.PLANS).get();
    const plans = new Map<string, Plan>();
    for (const doc of plansSnap.docs) {
      const data = doc.data() as Omit<Plan, "id">;
      plans.set(data.key, { ...(data as Plan), id: doc.id });
    }

    let rolledOver = 0;
    let skipped = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const subDoc of candidates.docs) {
      const subId = subDoc.id;
      try {
        await db.runTransaction(async (tx) => {
          const subRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subId);
          const freshSnap = await tx.get(subRef);
          if (!freshSnap.exists) {
            skipped++;
            return;
          }

          const fresh = {
            id: freshSnap.id,
            ...(freshSnap.data() as Omit<Subscription, "id">),
          } as Subscription;

          const sc = fresh.scheduledChange as ScheduledChange | undefined;
          if (!sc) {
            skipped++;
            return;
          }
          if (new Date(sc.effectiveAt).getTime() > now.getTime()) {
            skipped++;
            return;
          }
          if (fresh.status === "past_due") {
            skipped++;
            return;
          }

          const targetPlan = sc.toPlan;
          const catalogPlan = plans.get(targetPlan);
          const legacy = PLAN_LIMITS[targetPlan as OrganizationPlan];
          const targetFeatures = catalogPlan?.features ?? legacy?.features;
          const targetPlanKey = catalogPlan?.key ?? targetPlan;
          const targetPriceXof =
            catalogPlan?.priceXof ?? PLAN_DISPLAY[targetPlan as OrganizationPlan]?.priceXof ?? 0;

          const limits = catalogPlan?.limits ?? {
            maxEvents: runtimeToStored(legacy?.maxEvents ?? 0),
            maxParticipantsPerEvent: runtimeToStored(legacy?.maxParticipantsPerEvent ?? 0),
            maxMembers: runtimeToStored(legacy?.maxMembers ?? 0),
          };
          const storedLimits = {
            maxEvents: runtimeToStored(storedToRuntime(limits.maxEvents)),
            maxParticipantsPerEvent: runtimeToStored(
              storedToRuntime(limits.maxParticipantsPerEvent),
            ),
            maxMembers: runtimeToStored(storedToRuntime(limits.maxMembers)),
          };

          // Apply subscription update.
          const subUpdate: Record<string, unknown> = {
            plan: targetPlan,
            priceXof: targetPriceXof,
            scheduledChange: null,
            updatedAt: nowIso,
          };
          if (catalogPlan?.id) subUpdate.planId = catalogPlan.id;
          if (targetPlan === "free") {
            subUpdate.status = "cancelled";
            subUpdate.cancelledAt = nowIso;
          }
          tx.update(subRef, subUpdate);

          // Apply org update (plan + denormalized effective fields).
          const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(fresh.organizationId);
          const orgSnap = await tx.get(orgRef);
          if (!orgSnap.exists) {
            skipped++;
            return;
          }
          const org = {
            id: orgSnap.id,
            ...(orgSnap.data() as Omit<Organization, "id">),
          } as Organization;

          const orgUpdate: Record<string, unknown> = {
            plan: targetPlan,
            updatedAt: nowIso,
          };
          if (targetFeatures) {
            orgUpdate.effectiveFeatures = { ...targetFeatures };
            orgUpdate.effectivePlanKey = targetPlanKey;
            orgUpdate.effectiveLimits = storedLimits;
            orgUpdate.effectiveComputedAt = nowIso;
          }
          tx.update(orgRef, orgUpdate);

          // Write the audit log directly — the service-level eventBus isn't
          // easily reachable from a Cloud Function context.
          const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
          tx.set(auditRef, {
            action: "subscription.period_rolled_over",
            actorId: "system:subscription-rollover",
            requestId: `rollover-${now.getTime()}`,
            timestamp: nowIso,
            resourceType: "subscription",
            resourceId: fresh.organizationId,
            eventId: null,
            organizationId: fresh.organizationId,
            details: {
              fromPlan: org.plan,
              toPlan: targetPlan,
              reason: sc.reason,
            },
          });

          rolledOver++;
        });
      } catch (err) {
        errors.push({
          id: subId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("Subscription rollover complete", {
      scanned: candidates.size,
      rolledOver,
      skipped,
      errors: errors.length,
    });
    if (errors.length > 0) {
      for (const e of errors) {
        logger.error(`Rollover failed for subscription ${e.id}: ${e.message}`);
      }
    }
  },
);
