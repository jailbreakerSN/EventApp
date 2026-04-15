import { describe, it, expect, beforeEach } from "vitest";
import { PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";
import { planService } from "@/services/plan.service";
import { subscriptionService } from "@/services/subscription.service";
import { planRepository } from "@/repositories/plan.repository";
import { buildSuperAdmin } from "@/__tests__/factories";
import { db, COLLECTIONS } from "@/config/firebase";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createSubscription,
  readOrg,
  readPlan,
} from "./helpers";

/**
 * Regression coverage for Phase 7 — plan versioning & grandfathering.
 *
 * The **contract**: a superadmin edit to a live plan (priceXof / limits /
 * features) MUST create a brand-new version doc. Existing subscriptions
 * remain pinned to the version they were assigned under; only new
 * signups / new `assignPlan` calls see the fresh version.
 *
 * This is the single most load-bearing invariant in the billing subsystem.
 * A bug here silently retightens quotas for paying customers mid-contract
 * — legal, commercial, and retention catastrophe.
 *
 * We prove the contract by exercising the real service → real Firestore
 * emulator, reading back catalog docs + org effective fields, and
 * asserting nothing drifts for the grandfathered org.
 */
describe("Integration: plan versioning & grandfathering (Phase 7)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("editing priceXof on a system plan mints v2 and flips v1 to isLatest=false", async () => {
    const admin = buildSuperAdmin();
    const v1 = await readPlan("pro");
    expect(v1?.version).toBe(1);
    expect(v1?.isLatest).toBe(true);
    const lineageId = v1!.lineageId;

    const v2 = await planService.update("pro", { priceXof: 34900 }, admin);

    // v2 is a NEW doc with a fresh id, same lineage, incremented version.
    expect(v2.id).not.toBe("pro");
    expect(v2.version).toBe(2);
    expect(v2.lineageId).toBe(lineageId);
    expect(v2.isLatest).toBe(true);
    expect(v2.previousVersionId).toBe("pro");
    expect(v2.priceXof).toBe(34900);

    // v1 still exists but is no longer the latest. Pricing unchanged.
    const v1After = await readPlan("pro");
    expect(v1After?.version).toBe(1);
    expect(v1After?.isLatest).toBe(false);
    expect(v1After?.priceXof).toBe(29900); // original
  });

  it("catalog listings + findByKey surface only the latest version by default", async () => {
    const admin = buildSuperAdmin();
    await planService.update(
      "pro",
      { limits: { maxEvents: 99, maxParticipantsPerEvent: 2000, maxMembers: 50 } },
      admin,
    );

    // Public catalog: only latest.
    const publicCatalog = await planService.getPublicCatalog();
    const proRows = publicCatalog.filter((p) => p.key === "pro");
    expect(proRows).toHaveLength(1);
    expect(proRows[0]!.version).toBe(2);
    expect(proRows[0]!.limits.maxEvents).toBe(99);

    // findByKey resolves to the latest version.
    const latest = await planRepository.findByKey("pro");
    expect(latest?.version).toBe(2);

    // Lineage listing includes both versions, newest first.
    const lineage = await planService.listLineage("pro", admin);
    expect(lineage).toHaveLength(2);
    expect(lineage[0]!.version).toBe(2);
    expect(lineage[1]!.version).toBe(1);
  });

  it("existing orgs on v1 are fully grandfathered after a plan edit", async () => {
    // Seed an org + subscription on pro v1, exactly like production would
    // look for a customer who signed up before the version bump.
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("pro");
    await createSubscription(orgId, "pro", { id: `sub-${orgId}`, planId: "pro" });

    const orgBefore = await readOrg(orgId);
    const limitsBefore = orgBefore.effectiveLimits;
    expect(limitsBefore?.maxEvents).toBe(PLAN_LIMIT_UNLIMITED);

    // Superadmin tightens pro's maxParticipantsPerEvent from 2000 → 500.
    await planService.update(
      "pro",
      { limits: { maxEvents: PLAN_LIMIT_UNLIMITED, maxParticipantsPerEvent: 500, maxMembers: 50 } },
      admin,
    );

    // Grandfathered org's denormalised effective fields were NOT touched.
    // (No background fan-out — they keep their v1 snapshot until a future
    // migrate-cohort button explicitly opts them in.)
    const orgAfter = await readOrg(orgId);
    expect(orgAfter.effectiveLimits?.maxParticipantsPerEvent).toBe(
      limitsBefore?.maxParticipantsPerEvent,
    );
    // Subscription still points at v1.
    const subSnap = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(`sub-${orgId}`).get();
    expect(subSnap.data()?.planId).toBe("pro");
  });

  it("new assignPlan after an edit pins the subscription to v2", async () => {
    const admin = buildSuperAdmin();
    // Edit pro first so v2 exists.
    const v2 = await planService.update(
      "pro",
      { limits: { maxEvents: PLAN_LIMIT_UNLIMITED, maxParticipantsPerEvent: 500, maxMembers: 50 } },
      admin,
    );

    const { id: orgId } = await createOrgOnPlan("free");
    // Admin assigns "pro" by id — they'd normally pick the latest via the
    // UI, which is what the repository returns on findByKey now.
    const latest = await planRepository.findByKey("pro");
    const sub = await subscriptionService.assignPlan(orgId, { planId: latest!.id }, admin);

    expect(sub.planId).toBe(v2.id);

    // The denormalised org snapshot reflects v2's limits (500), not v1's 2000.
    const org = await readOrg(orgId);
    expect(org.effectiveLimits?.maxParticipantsPerEvent).toBe(500);
  });

  it("re-running the seed does NOT mint a new version (idempotent)", async () => {
    const beforeAll = await planService.listLineage("pro", buildSuperAdmin());
    expect(beforeAll).toHaveLength(1);

    // Re-seed.
    await seedSystemPlans();

    const afterAll = await planService.listLineage("pro", buildSuperAdmin());
    expect(afterAll).toHaveLength(1); // still just v1, no version bump
    expect(afterAll[0]!.version).toBe(1);
  });

  it("historical versions are frozen — editing one is refused", async () => {
    const admin = buildSuperAdmin();
    const v2 = await planService.update("pro", { priceXof: 34900 }, admin);
    void v2;

    // Try to edit the old v1 doc directly.
    await expect(planService.update("pro", { priceXof: 9999 }, admin)).rejects.toThrow(
      "version historique",
    );
  });

  it("display-only fields patch in place — no new version (sortOrder, isPublic)", async () => {
    const admin = buildSuperAdmin();
    const beforeCount = (await planService.listLineage("pro", admin)).length;

    await planService.update("pro", { sortOrder: 42 }, admin);

    const afterCount = (await planService.listLineage("pro", admin)).length;
    expect(afterCount).toBe(beforeCount);
    const latest = await planRepository.findByKey("pro");
    expect(latest?.sortOrder).toBe(42);
    expect(latest?.version).toBe(1); // still v1, patched in place
  });
});
