import {
  type Organization,
  type Subscription,
  type Plan,
  type ScheduledChange,
  PLAN_LIMITS,
  PLAN_DISPLAY,
  PLAN_LIMIT_UNLIMITED,
  type OrganizationPlan,
} from "@teranga/shared-types";
import { randomUUID } from "node:crypto";
import { type Firestore } from "firebase-admin/firestore";
import { db as appDb } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";

// ─── Subscription Rollover Worker ────────────────────────────────────────────
//
// Phase 4c: applies any `scheduledChange` whose `effectiveAt` has passed.
//
// Extracted into a standalone function (separate from subscription.service)
// so it can be driven from three callers:
//  1. Firebase Scheduled Function (cron, daily at 02:00 Africa/Dakar)
//  2. Test suites (synchronous invocation with a clock injected via `now`)
//  3. Ad-hoc admin script if the scheduled function ever backlogs.
//
// Idempotency: a rollover writes the scheduled plan onto the subscription
// (clearing `scheduledChange`) and rewrites `org.effectiveLimits` etc.
// Re-running the worker after a successful rollover is a no-op because the
// `scheduledChange` field has been cleared by the first run.

function storedToRuntime(n: number): number {
  return n === PLAN_LIMIT_UNLIMITED ? Infinity : n;
}

function runtimeToStored(n: number): number {
  return Number.isFinite(n) ? n : PLAN_LIMIT_UNLIMITED;
}

export interface RolloverResult {
  scanned: number;
  rolledOver: number;
  skipped: number;
  errors: Array<{ subscriptionId: string; message: string }>;
}

export interface RolloverRow {
  organizationId: string;
  fromPlan: string;
  toPlan: string;
  reason: string;
}

export interface ApplyScheduledRolloversOptions {
  now?: Date;
  // Called after a successful rollover so the caller can emit domain events
  // (the service-layer eventBus isn't available in a standalone function
  // context like a Cloud Function without re-importing the whole app).
  onRolledOver?: (row: RolloverRow) => void;
}

/**
 * Scan subscriptions with an overdue `scheduledChange` and apply each one
 * transactionally: update subscription plan/planId/priceXof/cancelledAt +
 * rewrite the org's denormalized effective* fields.
 *
 * Skips silently (with a log entry in the result) if:
 *  - The subscription doc changed between query and transaction (re-read
 *    inside the tx and re-check the guard).
 *  - The scheduled target plan is missing from the catalog AND no legacy
 *    PLAN_LIMITS fallback covers it (shouldn't happen for "free" → always
 *    falls back).
 *  - `status === "past_due"` — orgs in dunning aren't rolled over; the
 *    payment-failure flow owns their lifecycle.
 */
export async function applyScheduledRollovers(
  db: Firestore,
  options: ApplyScheduledRolloversOptions = {},
): Promise<RolloverResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const candidates = await db
    .collection("subscriptions")
    .where("scheduledChange.effectiveAt", "<=", nowIso)
    .get();

  const result: RolloverResult = {
    scanned: candidates.size,
    rolledOver: 0,
    skipped: 0,
    errors: [],
  };

  if (candidates.empty) return result;

  // Preload the catalog once.
  const plansSnap = await db.collection("plans").get();
  const plans = new Map<string, Plan>();
  for (const doc of plansSnap.docs) {
    const data = doc.data() as Omit<Plan, "id">;
    plans.set(data.key, { ...(data as Plan), id: doc.id });
  }

  for (const subDoc of candidates.docs) {
    const sub = { id: subDoc.id, ...(subDoc.data() as Omit<Subscription, "id">) } as Subscription;
    try {
      const outcome = await db.runTransaction(async (tx) => {
        // ── All reads FIRST (Firestore requires reads before writes in a tx)
        const subRef = db.collection("subscriptions").doc(sub.id);
        const orgRef = db.collection("organizations").doc(sub.organizationId);
        const [freshSnap, orgSnap] = await Promise.all([tx.get(subRef), tx.get(orgRef)]);
        if (!freshSnap.exists) return { status: "skipped" as const };

        const fresh = {
          id: freshSnap.id,
          ...(freshSnap.data() as Omit<Subscription, "id">),
        } as Subscription;

        // Re-check the guard — another process may have cleared or updated
        // the scheduled change between the query and the transaction.
        const sc = fresh.scheduledChange as ScheduledChange | undefined;
        if (!sc) return { status: "skipped" as const };
        if (new Date(sc.effectiveAt).getTime() > now.getTime()) {
          return { status: "skipped" as const };
        }
        if (fresh.status === "past_due") {
          // Dunning owns this sub's lifecycle; don't compound the state.
          return { status: "skipped" as const };
        }

        if (!orgSnap.exists) {
          // Edge case: org gone but subscription lingered. Nothing more to do.
          return { status: "skipped" as const };
        }
        const org = {
          id: orgSnap.id,
          ...(orgSnap.data() as Omit<Organization, "id">),
        } as Organization;

        const targetPlan = sc.toPlan;
        const catalogPlan = sc.toPlanId
          ? plans.get(targetPlan as OrganizationPlan)
          : plans.get(targetPlan as OrganizationPlan);

        // Compute effective limits for the target. Prefer the catalog entry
        // (honors live edits to the plan between schedule and rollover);
        // fall back to the hardcoded PLAN_LIMITS for known tiers.
        const legacy = PLAN_LIMITS[targetPlan as OrganizationPlan];
        const targetLimits = catalogPlan?.limits ?? {
          maxEvents: runtimeToStored(legacy?.maxEvents ?? 0),
          maxParticipantsPerEvent: runtimeToStored(legacy?.maxParticipantsPerEvent ?? 0),
          maxMembers: runtimeToStored(legacy?.maxMembers ?? 0),
        };
        const targetFeatures = catalogPlan?.features ?? legacy?.features;
        const targetPlanKey = catalogPlan?.key ?? targetPlan;
        const targetPriceXof =
          catalogPlan?.priceXof ?? PLAN_DISPLAY[targetPlan as OrganizationPlan]?.priceXof ?? 0;

        // ── All writes AFTER all reads
        //
        // Trial ending (Phase 7+ item #4) is a special case: the rollover
        // toPlan is the SAME as the current plan — we only flip status from
        // "trialing" → "active" and re-enable billing (priceXof from the
        // catalog, honouring the subscription's billingCycle). No
        // denormalisation change on the org doc (effective limits already
        // match). We also advance `currentPeriodEnd` by a full monthly /
        // annual cadence from the trial-end boundary so the next renewal
        // fires on schedule.
        const isTrialEnd = sc.reason === "trial_ended";

        // Trial end: honour the subscription's chosen billingCycle (Phase
        // 7+ item #3). Fall back to "monthly" for subs written before that
        // field landed.
        const cycle = (fresh.billingCycle ?? "monthly") as "monthly" | "annual";
        const postTrialPriceXof =
          cycle === "annual"
            ? (catalogPlan?.annualPriceXof ?? 0)
            : (catalogPlan?.priceXof ?? targetPriceXof);
        const renewedPeriodEnd = new Date(sc.effectiveAt);
        if (cycle === "annual") {
          renewedPeriodEnd.setFullYear(renewedPeriodEnd.getFullYear() + 1);
        } else {
          renewedPeriodEnd.setMonth(renewedPeriodEnd.getMonth() + 1);
        }

        const subUpdate: Record<string, unknown> = {
          plan: targetPlan,
          priceXof: isTrialEnd ? postTrialPriceXof : targetPriceXof,
          scheduledChange: null,
          updatedAt: nowIso,
        };
        if (catalogPlan?.id) subUpdate.planId = catalogPlan.id;
        if (isTrialEnd) {
          subUpdate.status = "active";
          subUpdate.currentPeriodStart = sc.effectiveAt;
          subUpdate.currentPeriodEnd = renewedPeriodEnd.toISOString();
        } else if (targetPlan === "free") {
          subUpdate.status = "cancelled";
          subUpdate.cancelledAt = nowIso;
        }
        tx.update(subRef, subUpdate);

        // Trial end: the org's denormalised snapshot already matches the
        // trialing plan, so skip the org write entirely. Saves one tx write
        // and keeps `effectiveComputedAt` pointing at the enrolment timestamp
        // (meaningful for audit / support).
        if (!isTrialEnd) {
          const orgUpdate: Record<string, unknown> = {
            plan: targetPlan,
            updatedAt: nowIso,
          };
          if (targetFeatures) {
            orgUpdate.effectiveFeatures = { ...targetFeatures };
            orgUpdate.effectivePlanKey = targetPlanKey;
            orgUpdate.effectiveLimits = {
              maxEvents: targetLimits.maxEvents,
              maxParticipantsPerEvent: targetLimits.maxParticipantsPerEvent,
              maxMembers: targetLimits.maxMembers,
            };
            orgUpdate.effectiveComputedAt = nowIso;
            // Convert any runtime Infinity present in legacy fallback to
            // stored -1 for Firestore.
            const limits = orgUpdate.effectiveLimits as Record<string, number>;
            limits.maxEvents = runtimeToStored(storedToRuntime(limits.maxEvents));
            limits.maxParticipantsPerEvent = runtimeToStored(
              storedToRuntime(limits.maxParticipantsPerEvent),
            );
            limits.maxMembers = runtimeToStored(storedToRuntime(limits.maxMembers));
            // Phase 7+ item #2 — ALWAYS write the entitlement map (empty
            // when the target plan has none) so a scheduled downgrade /
            // cancel that crosses the unified/legacy boundary doesn't
            // leave stale entitlement keys on the org doc. Review
            // blocker B2. The rollover worker doesn't resolve overrides
            // here — scheduled changes carry `toPlanOverrides` on the
            // subscription, but the existing rollover already operates
            // on `catalogPlan` fields only, so we mirror that: the
            // target plan's entitlements go straight onto the org.
            orgUpdate.effectiveEntitlements = catalogPlan?.entitlements ?? {};
          }
          tx.update(orgRef, orgUpdate);
        }

        return {
          status: "applied" as const,
          fromPlan: org.plan,
          toPlan: targetPlan,
          reason: sc.reason,
          organizationId: sub.organizationId,
        };
      });

      if (outcome.status === "applied") {
        result.rolledOver++;
        options.onRolledOver?.({
          organizationId: outcome.organizationId,
          fromPlan: outcome.fromPlan,
          toPlan: outcome.toPlan,
          reason: outcome.reason,
        });
      } else {
        result.skipped++;
      }
    } catch (err) {
      result.errors.push({
        subscriptionId: sub.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * App-side entry point that wires the eventBus as the default `onRolledOver`.
 * Used by any future API surface (admin-manual rollover endpoint, ops script)
 * that needs the domain event to fire for audit logging. The scheduled Cloud
 * Function writes the audit log directly (it can't reach the app-side event
 * bus across the Functions / Cloud Run boundary), so this wrapper exists only
 * for callers that live inside the Fastify process.
 */
export async function runScheduledRollovers(
  options: ApplyScheduledRolloversOptions = {},
): Promise<RolloverResult> {
  // Rollover worker runs outside any Fastify request, so no ALS store is
  // active. Use a fresh UUID so each scheduled run is traceable in the
  // audit log instead of the "no-request" sentinel.
  const batchRequestId = `rollover:${randomUUID()}`;
  return applyScheduledRollovers(appDb, {
    ...options,
    onRolledOver: (row) => {
      options.onRolledOver?.(row);
      eventBus.emit("subscription.period_rolled_over", {
        organizationId: row.organizationId,
        fromPlan: row.fromPlan,
        toPlan: row.toPlan,
        reason: row.reason,
        actorId: "system:subscription-rollover",
        requestId: batchRequestId,
        timestamp: new Date().toISOString(),
      });
    },
  });
}
