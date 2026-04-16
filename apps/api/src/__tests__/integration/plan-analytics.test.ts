import { describe, it, expect, beforeEach } from "vitest";
import { adminService } from "@/services/admin.service";
import { subscriptionService } from "@/services/subscription.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { buildSuperAdmin, buildOrganizerUser } from "@/__tests__/factories";
import { clearFirestore, seedSystemPlans, createOrgOnPlan, createSubscription } from "./helpers";

/**
 * Regression coverage for Phase 7+ item #5 — MRR / cohort dashboard.
 *
 * End-to-end contract on the real Firestore emulator:
 *   - reads live `subscriptions` / `organizations` / `plans` + per-org
 *     event counts
 *   - returns a `PlanAnalytics` shape matching the shared-types schema
 *   - composes correctly with Phase 7 versioning (tier mix by version)
 *     and Phase 7+ items #3 / #4 (annual billing + trials)
 *
 * Unit tests in `services/__tests__/plan-analytics.test.ts` cover the
 * pure fold exhaustively. This file proves the I/O shell is wired
 * correctly and the whole stack produces sensible numbers.
 */
describe("Integration: plan analytics (Phase 7+ item #5)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("computes MRR, tier mix, annual/monthly split from live subscriptions", async () => {
    const admin = buildSuperAdmin();
    // Two active starter subs (monthly), one active pro (annual), one trial.
    const { id: starterA } = await createOrgOnPlan("starter", { id: "starter-a" });
    await createSubscription(starterA, "starter", {
      id: "sub-starter-a",
      status: "active",
      billingCycle: "monthly",
      priceXof: 9_900,
    });
    const { id: starterB } = await createOrgOnPlan("starter", { id: "starter-b" });
    await createSubscription(starterB, "starter", {
      id: "sub-starter-b",
      status: "active",
      billingCycle: "monthly",
      priceXof: 9_900,
    });
    const { id: proAnn } = await createOrgOnPlan("pro", { id: "pro-annual" });
    await createSubscription(proAnn, "pro", {
      id: "sub-pro-annual",
      status: "active",
      billingCycle: "annual",
      priceXof: 287_040,
    });
    // Trial kicked off via the real service so the scheduledChange +
    // status are set up identically to production.
    const { id: trialOrg } = await createOrgOnPlan("free", { id: "free-trial" });
    await subscriptionService.upgrade(trialOrg, { plan: "pro" }, buildOrganizerUser(trialOrg));

    const analytics = await adminService.getPlanAnalytics(admin);

    // 2 × 9 900 (starter monthly) + 287 040 / 12 (pro annual, normalised)
    //                                  = 19 800 + 23 920 = 43 720
    expect(analytics.mrr.total).toBe(43_720);
    expect(analytics.mrr.byTier.starter).toBe(19_800);
    expect(analytics.mrr.byTier.pro).toBe(23_920);

    // Bookings: raw cash recognised this period. The annual sub's full
    // 287 040 is booked now; the monthly subs billed 9 900 × 2.
    expect(analytics.bookings.total).toBe(9_900 + 9_900 + 287_040);

    // Trialing pro contributes to pipeline MRR (29 900, monthly cadence).
    expect(analytics.trialingMRR.byTier.pro).toBe(29_900);

    // Tier mix: 2 starter + 1 pro active + 1 pro trialing = 4 orgs bucketed.
    expect(analytics.tierMix.starter?.count).toBe(2);
    expect(analytics.tierMix.pro?.count).toBe(2);

    // Split.
    expect(analytics.annualVsMonthly).toEqual({ monthly: 2, annual: 1 });
  });

  it("surfaces trialing orgs whose trial ends within the next 7 days", async () => {
    const admin = buildSuperAdmin();
    const { id: orgA } = await createOrgOnPlan("free", { id: "trial-ends-soon", name: "Soon" });
    // Kick off a real trial via the service — that sets status=trialing
    // and currentPeriodEnd = now + 14d (seeded pro trialDays).
    await subscriptionService.upgrade(orgA, { plan: "pro" }, buildOrganizerUser(orgA));

    // Manually rewind currentPeriodEnd to within the 7-day window so the
    // dashboard query picks it up.
    const threeDaysOut = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const subs = await db
      .collection(COLLECTIONS.SUBSCRIPTIONS)
      .where("organizationId", "==", orgA)
      .get();
    await subs.docs[0]!.ref.update({ currentPeriodEnd: threeDaysOut });

    const analytics = await adminService.getPlanAnalytics(admin);

    expect(analytics.trialsEndingSoon).toHaveLength(1);
    expect(analytics.trialsEndingSoon[0]!.orgName).toBe("Soon");
    expect(analytics.trialsEndingSoon[0]!.tier).toBe("pro");
  });

  it("flags near-limit orgs at ≥80% of their effective member/event limits", async () => {
    const admin = buildSuperAdmin();
    // Free tier has maxMembers=1. Put the org at 1/1 → 100%.
    const { id: orgAtMembers } = await createOrgOnPlan("free", {
      id: "org-at-member-limit",
      name: "Maxed Members",
      memberIds: ["owner-uid"],
    });
    await createSubscription(orgAtMembers, "free", { id: `sub-${orgAtMembers}` });

    // Safe org: 0 members on free tier.
    const { id: orgSafe } = await createOrgOnPlan("free", {
      id: "org-safe",
      name: "Safe",
      memberIds: [],
    });
    await createSubscription(orgSafe, "free", { id: `sub-${orgSafe}` });

    const analytics = await adminService.getPlanAnalytics(admin);

    const names = analytics.nearLimitOrgs.map((n) => n.orgName);
    expect(names).toContain("Maxed Members");
    expect(names).not.toContain("Safe");
    const entry = analytics.nearLimitOrgs.find((n) => n.orgName === "Maxed Members")!;
    expect(entry.resource).toBe("members");
    expect(entry.pct).toBeGreaterThanOrEqual(80);
  });

  it("counts active overrides separately from tierMix", async () => {
    const admin = buildSuperAdmin();
    const { id: orgOverride } = await createOrgOnPlan("pro", { id: "org-override" });
    // Assign pro with an override valid for a year.
    const validUntil = new Date(Date.now() + 365 * 86_400_000).toISOString();
    await subscriptionService.assignPlan(
      orgOverride,
      { planId: "pro", overrides: { limits: { maxMembers: 200 }, validUntil } },
      admin,
    );
    // Also a plain pro sub so we can see the override isn't counted in
    // the tier mix alongside it.
    const { id: orgPlain } = await createOrgOnPlan("pro", { id: "org-plain" });
    await createSubscription(orgPlain, "pro", { id: "sub-plain", status: "active" });

    const analytics = await adminService.getPlanAnalytics(admin);

    expect(analytics.overrideCount).toBe(1);
    // tierMix.pro counts only the plain sub — the override is excluded.
    expect(analytics.tierMix.pro?.count).toBe(1);
  });

  it("requires super_admin — plain organizer gets a ForbiddenError", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const organizer = buildOrganizerUser(orgId);
    await expect(adminService.getPlanAnalytics(organizer)).rejects.toThrow("Permission manquante");
  });

  it("returns zero-aggregates shape on an empty database", async () => {
    await clearFirestore(); // skip the seedSystemPlans reset
    const admin = buildSuperAdmin();
    const analytics = await adminService.getPlanAnalytics(admin);

    expect(analytics.mrr.total).toBe(0);
    expect(analytics.tierMix).toEqual({});
    expect(analytics.trialsEndingSoon).toEqual([]);
    expect(analytics.nearLimitOrgs).toEqual([]);
    expect(analytics.overrideCount).toBe(0);
    expect(typeof analytics.computedAt).toBe("string");
  });
});
