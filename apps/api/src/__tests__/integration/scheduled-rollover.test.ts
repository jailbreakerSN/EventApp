import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/config/firebase";
import { subscriptionService } from "@/services/subscription.service";
import { applyScheduledRollovers } from "@/services/subscription-rollover";
import { PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";
import { buildAuthUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createSubscription,
  readOrg,
  readSubscription,
} from "./helpers";

/**
 * Scenario 4 (Phase 7+ roadmap, exit criterion #4): "Organizer cancels →
 * `scheduledChange` queued; fake-clock forward → rollover worker flips to free."
 *
 * The rollover function (`applyScheduledRollovers`) takes an explicit `now`
 * argument precisely so tests can jump forward in time without touching the
 * system clock. Exercising the real Firestore transaction path validates
 * that the worker is safe to run under the scheduled Cloud Function.
 */
describe("Integration: scheduled rollover (Phase 4c)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("cancel queues scheduledChange; rollover flips subscription + org at effectiveAt", async () => {
    const { id: orgId } = await createOrgOnPlan("pro");
    // Using an explicit super_admin keeps the test insensitive to the exact
    // role→permission mapping for organization:manage_billing. What we're
    // validating is the rollover flow end-to-end, not the permission model.
    const admin = buildAuthUser({ roles: ["super_admin"] });

    // Active pro subscription ending in 7 days.
    const periodEnd = new Date(Date.now() + 7 * 86400000).toISOString();
    const subId = `sub-${orgId}`;
    await createSubscription(orgId, "pro", {
      id: subId,
      currentPeriodEnd: periodEnd,
    });

    // Customer cancels — schedule, not flip.
    const result = await subscriptionService.cancel(orgId, admin);
    expect(result.scheduled).toBe(true);
    expect(result.effectiveAt).toBe(periodEnd);

    const afterCancel = await readSubscription(subId);
    expect(afterCancel?.scheduledChange?.toPlan).toBe("free");
    expect(afterCancel?.scheduledChange?.reason).toBe("cancel");
    expect(afterCancel?.plan).toBe("pro"); // still pro until period end
    expect(afterCancel?.status).toBe("active");

    const orgBefore = await readOrg(orgId);
    // Effective snapshot untouched — prepaid rights intact.
    expect(orgBefore.plan).toBe("pro");
    expect(orgBefore.effectivePlanKey).toBe("pro");

    // Fake-forward past the period end and run the rollover.
    const nowAfterPeriod = new Date(new Date(periodEnd).getTime() + 60_000);
    const rolledRows: string[] = [];
    const summary = await applyScheduledRollovers(db, {
      now: nowAfterPeriod,
      onRolledOver: (row) => rolledRows.push(`${row.fromPlan}→${row.toPlan}:${row.reason}`),
    });

    // Diagnostic-friendly ordering: errors first so a misfire surfaces
    // before the headline count assertion.
    expect(summary.errors).toEqual([]);
    expect(summary.skipped).toBe(0);
    expect(summary.rolledOver).toBe(1);
    expect(rolledRows).toEqual(["pro→free:cancel"]);

    // Subscription flipped to free + cancelled, scheduledChange cleared.
    const afterRollover = await readSubscription(subId);
    expect(afterRollover?.plan).toBe("free");
    expect(afterRollover?.status).toBe("cancelled");
    expect(afterRollover?.cancelledAt).toBeTruthy();
    expect(afterRollover?.scheduledChange ?? null).toBeNull();

    // Org denormalisation now reflects free-tier limits.
    const orgAfter = await readOrg(orgId);
    expect(orgAfter.plan).toBe("free");
    expect(orgAfter.effectivePlanKey).toBe("free");
    expect(orgAfter.effectiveLimits?.maxEvents).toBe(3);
    expect(orgAfter.effectiveLimits?.maxMembers).toBe(1);
    expect(orgAfter.effectiveFeatures?.qrScanning).toBe(false);
    // Sanity: confirm -1 (unlimited) hasn't leaked into free (which is finite).
    expect(orgAfter.effectiveLimits?.maxEvents).not.toBe(PLAN_LIMIT_UNLIMITED);
  });

  it("is idempotent — re-running the rollover after a successful flip is a no-op", async () => {
    const admin = buildAuthUser({ roles: ["super_admin"] });
    const { id: orgId } = await createOrgOnPlan("pro");
    const periodEnd = new Date(Date.now() + 7 * 86400000).toISOString();
    await createSubscription(orgId, "pro", {
      id: `sub-${orgId}`,
      currentPeriodEnd: periodEnd,
    });
    await subscriptionService.cancel(orgId, admin);

    const past = new Date(new Date(periodEnd).getTime() + 60_000);
    const first = await applyScheduledRollovers(db, { now: past });
    expect(first.rolledOver).toBe(1);

    const second = await applyScheduledRollovers(db, { now: past });
    // No remaining overdue scheduledChange → scan finds nothing.
    expect(second.scanned).toBe(0);
    expect(second.rolledOver).toBe(0);
  });

  it("reverting a scheduled change clears it so the rollover is a no-op", async () => {
    const admin = buildAuthUser({ roles: ["super_admin"] });
    const { id: orgId } = await createOrgOnPlan("pro");
    const periodEnd = new Date(Date.now() + 7 * 86400000).toISOString();
    const subId = `sub-${orgId}`;
    await createSubscription(orgId, "pro", {
      id: subId,
      currentPeriodEnd: periodEnd,
    });

    await subscriptionService.cancel(orgId, admin);
    const scheduled = await readSubscription(subId);
    expect(scheduled?.scheduledChange).toBeTruthy();

    await subscriptionService.revertScheduledChange(orgId, admin);
    const reverted = await readSubscription(subId);
    expect(reverted?.scheduledChange ?? null).toBeNull();

    // Rollover beyond effectiveAt — should not flip the sub.
    const past = new Date(new Date(periodEnd).getTime() + 60_000);
    const summary = await applyScheduledRollovers(db, { now: past });
    expect(summary.rolledOver).toBe(0);

    const after = await readSubscription(subId);
    expect(after?.plan).toBe("pro");
    expect(after?.status).toBe("active");
  });
});
