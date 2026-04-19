import { describe, it, expect, beforeEach } from "vitest";
import { PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";
import { subscriptionService } from "@/services/subscription.service";
import { buildSuperAdmin } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createSubscription,
  readOrg,
  readSubscription,
} from "./helpers";

/**
 * Scenario 2 (Phase 7+ roadmap, exit criterion #2): "Superadmin assigns a
 * custom plan to an org → org's `effectiveLimits` reflects it immediately."
 *
 * Also covers the Phase 5 per-dimension override behaviour: the admin can
 * pin specific limits / features / priceXof while inheriting the rest from
 * the catalog plan. validUntil is stored on the subscription so the Cloud
 * Function expiry job can pick it up later (not under test here).
 */
describe("Integration: admin assignPlan (Phase 5)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("assigns a system plan to an org and denormalises effective fields", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("free");

    const sub = await subscriptionService.assignPlan(orgId, { planId: "pro" }, admin);

    // Subscription doc now points at the pro catalog plan.
    expect(sub.plan).toBe("pro");
    expect(sub.planId).toBe("pro");
    expect(sub.assignedBy).toBe(admin.uid);

    // Org effective fields reflect the pro plan limits (read back from DB).
    const org = await readOrg(orgId);
    expect(org.plan).toBe("pro");
    expect(org.effectivePlanKey).toBe("pro");
    // Pro tier: maxEvents is unlimited (-1), maxParticipantsPerEvent 2000,
    // maxMembers 50.
    expect(org.effectiveLimits?.maxEvents).toBe(PLAN_LIMIT_UNLIMITED);
    expect(org.effectiveLimits?.maxParticipantsPerEvent).toBe(2000);
    expect(org.effectiveLimits?.maxMembers).toBe(50);
    expect(org.effectiveFeatures?.paidTickets).toBe(true);
    expect(org.effectiveFeatures?.smsNotifications).toBe(true);
  });

  it("honours per-dimension overrides on top of the base plan", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("free");

    const validUntil = new Date(Date.now() + 365 * 86400000).toISOString();
    const sub = await subscriptionService.assignPlan(
      orgId,
      {
        planId: "starter",
        overrides: {
          limits: { maxEvents: 200 }, // blow past starter's 10
          features: { smsNotifications: true }, // starter doesn't include SMS
          priceXof: 0, // partner deal — free
          notes: "Sonatel partnership 2026",
          validUntil,
        },
      },
      admin,
    );

    // Subscription captured the override.
    expect(sub.overrides?.limits?.maxEvents).toBe(200);
    expect(sub.overrides?.features?.smsNotifications).toBe(true);
    expect(sub.overrides?.validUntil).toBe(validUntil);
    expect(sub.priceXof).toBe(0);

    // Org's denormalised effective fields pick up the overrides.
    const org = await readOrg(orgId);
    expect(org.effectiveLimits?.maxEvents).toBe(200);
    // Other limits fell through to starter's values (200 / 3).
    expect(org.effectiveLimits?.maxParticipantsPerEvent).toBe(200);
    expect(org.effectiveLimits?.maxMembers).toBe(3);
    // Feature override layered onto the starter feature set.
    expect(org.effectiveFeatures?.smsNotifications).toBe(true);
    expect(org.effectiveFeatures?.qrScanning).toBe(true); // from starter base
  });

  it("replaces any previously-scheduled change on the subscription", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("pro");
    const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
    const subId = `sub-${orgId}`;
    await createSubscription(orgId, "pro", {
      id: subId,
      currentPeriodEnd: periodEnd,
      scheduledChange: {
        toPlan: "free",
        effectiveAt: periodEnd,
        reason: "cancel",
        scheduledBy: "previous-actor",
        scheduledAt: new Date().toISOString(),
      },
    });

    await subscriptionService.assignPlan(orgId, { planId: "enterprise" }, admin);

    const after = await readSubscription(subId);
    expect(after?.scheduledChange ?? null).toBeNull();
    expect(after?.plan).toBe("enterprise");
  });
});
