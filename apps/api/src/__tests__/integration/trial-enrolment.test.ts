import { describe, it, expect, beforeEach } from "vitest";
import { subscriptionService } from "@/services/subscription.service";
import { applyScheduledRollovers } from "@/services/subscription-rollover";
import { db } from "@/config/firebase";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createSubscription,
  readSubscription,
  readOrg,
} from "./helpers";

/**
 * Regression coverage for Phase 7+ item #4 — trial periods.
 *
 * The **contract**: a first-time upgrade from a non-paying org onto a
 * plan with `trialDays > 0` starts a trial (status "trialing",
 * priceXof suspended to 0, currentPeriodEnd = now + trialDays). A
 * scheduledChange with reason="trial_ended" is queued so the daily
 * rollover worker flips the sub to "active" at trial end. Second-
 * time upgrades (from an already-paid tier) skip the trial and
 * activate immediately.
 *
 * Seeded in helpers: pro carries trialDays=14, starter carries 0
 * (no trial), free / enterprise carry null.
 */
describe("Integration: trial enrolment (Phase 7+ item #4)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("first-time upgrade from free to pro starts a 14-day trial", async () => {
    const { id: orgId } = await createOrgOnPlan("free");
    const billingAdmin = buildOrganizerUser(orgId);

    const sub = await subscriptionService.upgrade(orgId, { plan: "pro" }, billingAdmin);

    // Trialing state + suspended price + 14-day period.
    expect(sub.plan).toBe("pro");
    expect(sub.status).toBe("trialing");
    expect(sub.priceXof).toBe(0);

    const periodLength =
      new Date(sub.currentPeriodEnd).getTime() - new Date(sub.currentPeriodStart).getTime();
    const days = Math.round(periodLength / 86_400_000);
    expect(days).toBe(14);

    // A scheduledChange for trial_ended is queued for the rollover worker.
    expect(sub.scheduledChange?.reason).toBe("trial_ended");
    expect(sub.scheduledChange?.toPlan).toBe("pro");
    expect(sub.scheduledChange?.effectiveAt).toBe(sub.currentPeriodEnd);

    // Org's denormalised effective fields already reflect pro tier — a
    // trialing customer has full access to the plan's features.
    const org = await readOrg(orgId);
    expect(org.effectivePlanKey).toBe("pro");
    expect(org.effectiveFeatures?.smsNotifications).toBe(true);
  });

  it("upgrade from a paid tier to pro skips the trial (no re-trialing)", async () => {
    // Org already on starter with an active subscription → upgrading to pro
    // must NOT grant another trial. Once a customer has paid for anything,
    // trials are over.
    const { id: orgId } = await createOrgOnPlan("starter");
    await createSubscription(orgId, "starter", {
      id: `sub-${orgId}`,
      status: "active",
      priceXof: 9900,
    });
    const billingAdmin = buildOrganizerUser(orgId);

    const sub = await subscriptionService.upgrade(orgId, { plan: "pro" }, billingAdmin);

    expect(sub.status).toBe("active");
    expect(sub.priceXof).toBe(29900); // pro's catalog price, not 0
    expect(sub.scheduledChange ?? null).toBeNull();

    // Period is a month (30 days), not 14.
    const periodLength =
      new Date(sub.currentPeriodEnd).getTime() - new Date(sub.currentPeriodStart).getTime();
    expect(periodLength).toBeGreaterThan(25 * 86_400_000);
  });

  it("upgrade to starter (trialDays=0) never starts a trial even from free", async () => {
    const { id: orgId } = await createOrgOnPlan("free");
    const billingAdmin = buildOrganizerUser(orgId);

    const sub = await subscriptionService.upgrade(orgId, { plan: "starter" }, billingAdmin);

    expect(sub.status).toBe("active");
    expect(sub.priceXof).toBe(9900); // starter price, no suspension
    expect(sub.scheduledChange ?? null).toBeNull();
  });

  it("rollover at trial end flips trialing → active and re-enables billing", async () => {
    const { id: orgId } = await createOrgOnPlan("free");
    const billingAdmin = buildOrganizerUser(orgId);

    const sub = await subscriptionService.upgrade(orgId, { plan: "pro" }, billingAdmin);
    expect(sub.status).toBe("trialing");
    expect(sub.priceXof).toBe(0);

    // Fake-forward past trial end.
    const afterTrialEnd = new Date(new Date(sub.currentPeriodEnd).getTime() + 60_000);
    const summary = await applyScheduledRollovers(db, { now: afterTrialEnd });

    expect(summary.errors).toEqual([]);
    expect(summary.rolledOver).toBe(1);

    // Sub flipped: status active, priceXof re-enabled from catalog, trial
    // scheduledChange cleared. Plan unchanged.
    const after = await readSubscription(sub.id);
    expect(after?.status).toBe("active");
    expect(after?.priceXof).toBe(29900);
    expect(after?.scheduledChange ?? null).toBeNull();
    expect(after?.plan).toBe("pro");

    // Org effective fields untouched (they already mirrored pro during trial).
    const org = await readOrg(orgId);
    expect(org.effectivePlanKey).toBe("pro");
    expect(org.plan).toBe("pro");
  });

  it("cancelling during a trial replaces trial_ended with a cancel scheduledChange", async () => {
    // User signs up for the pro trial then changes their mind the next day.
    // Cancel should REPLACE the trial_ended queue with a cancel queue (to
    // free, at trial end) — they keep pro until the trial expires, then
    // downgrade automatically.
    const { id: orgId } = await createOrgOnPlan("free");
    const billingAdmin = buildOrganizerUser(orgId);

    const sub = await subscriptionService.upgrade(orgId, { plan: "pro" }, billingAdmin);
    expect(sub.scheduledChange?.reason).toBe("trial_ended");
    const trialEndAt = sub.currentPeriodEnd;

    const result = await subscriptionService.cancel(
      orgId,
      buildAuthUser({ roles: ["super_admin"] }),
    );
    expect(result.scheduled).toBe(true);
    expect(result.effectiveAt).toBe(trialEndAt);

    const afterCancel = await readSubscription(sub.id);
    expect(afterCancel?.scheduledChange?.reason).toBe("cancel");
    expect(afterCancel?.scheduledChange?.toPlan).toBe("free");
    expect(afterCancel?.status).toBe("trialing"); // still trialing until rollover
  });

  it("editing a plan's trialDays mints a NEW version — trialing customers are grandfathered", async () => {
    // Start an org trialing pro under pro@v1 (trialDays=14).
    const { id: orgId } = await createOrgOnPlan("free");
    const billingAdmin = buildOrganizerUser(orgId);
    const sub = await subscriptionService.upgrade(orgId, { plan: "pro" }, billingAdmin);
    expect(sub.status).toBe("trialing");
    const trialEndAt = sub.currentPeriodEnd;

    // Superadmin "extends" the trial to 30 days on the catalog side — this
    // mints pro@v2 (Phase 7) and must NOT silently extend the in-flight
    // trial on v1. The customer's promise stays at 14.
    const { planService } = await import("@/services/plan.service");
    await planService.update("pro", { trialDays: 30 }, buildAuthUser({ roles: ["super_admin"] }));

    const unchanged = await readSubscription(sub.id);
    expect(unchanged?.currentPeriodEnd).toBe(trialEndAt); // NOT extended
    expect(unchanged?.scheduledChange?.effectiveAt).toBe(trialEndAt);
  });
});
