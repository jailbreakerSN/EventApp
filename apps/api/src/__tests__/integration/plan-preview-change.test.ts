import { describe, it, expect, beforeEach } from "vitest";
import { planService } from "@/services/plan.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { buildSuperAdmin } from "@/__tests__/factories";
import { clearFirestore, seedSystemPlans, createOrgOnPlan, createSubscription } from "./helpers";

/**
 * Regression coverage for Phase 7+ item #6 — plan-change dry-run / impact
 * preview.
 *
 * The **contract**: `previewChange(planId, dto)` simulates a plan edit and
 * returns the list of organisations whose current usage would violate the
 * new limits (or who would lose a feature they are currently using). No
 * mutation of the catalog happens. The UI calls this BEFORE Save to warn
 * the superadmin about blast radius.
 *
 * Pairs with Phase 7 versioning: versioning prevents silent retightening
 * at runtime; dry-run prevents the mistake from being made in the first
 * place.
 */
describe("Integration: plan preview-change (Phase 7+ item #6)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("tightening maxEvents surfaces orgs that would exceed the new cap", async () => {
    const admin = buildSuperAdmin();
    // Seed three orgs on pro — two overshoot the new cap, one fits.
    const { id: orgA } = await createOrgOnPlan("pro", { id: "org-a", name: "Acme" });
    await createSubscription(orgA, "pro", { id: "sub-a", planId: "pro" });
    // Create 3 active events for Acme.
    for (let i = 0; i < 3; i++) {
      await db
        .collection(COLLECTIONS.EVENTS)
        .doc(`evt-a-${i}`)
        .set({
          id: `evt-a-${i}`,
          organizationId: orgA,
          status: "published",
          title: `A-${i}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
    }
    const { id: orgB } = await createOrgOnPlan("pro", { id: "org-b", name: "Beta" });
    await createSubscription(orgB, "pro", { id: "sub-b", planId: "pro" });
    // Beta has 1 event — fits a cap of 2.
    await db.collection(COLLECTIONS.EVENTS).doc("evt-b-1").set({
      id: "evt-b-1",
      organizationId: orgB,
      status: "published",
      title: "B-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const preview = await planService.previewChange(
      "pro",
      { limits: { maxEvents: 2, maxParticipantsPerEvent: 2000, maxMembers: 50 } },
      admin,
    );

    expect(preview.willMintNewVersion).toBe(true);
    expect(preview.totalScanned).toBe(2);
    expect(preview.totalAffected).toBe(1);
    const acme = preview.affected.find((a) => a.orgId === "org-a")!;
    expect(acme.violations.some((v) => v.includes("événements"))).toBe(true);
    const beta = preview.affected.find((a) => a.orgId === "org-b")!;
    expect(beta.violations).toEqual([]);
  });

  it("raising a limit returns no violations — no false positives", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("pro");
    await createSubscription(orgId, "pro", { id: `sub-${orgId}`, planId: "pro" });

    const preview = await planService.previewChange(
      "pro",
      { limits: { maxEvents: 9999, maxParticipantsPerEvent: 5000, maxMembers: 200 } },
      admin,
    );

    expect(preview.willMintNewVersion).toBe(true);
    expect(preview.totalAffected).toBe(0);
    expect(preview.affected[0]?.violations).toEqual([]);
  });

  it("overrides mask violations (org with maxMembers override of 50 not flagged by new cap of 3)", async () => {
    const admin = buildSuperAdmin();
    const { id: orgA } = await createOrgOnPlan("pro", {
      id: "org-override",
      memberIds: Array.from({ length: 20 }, (_, i) => `m${i}`),
    });
    // Sub carries an override pushing maxMembers to 50 — the new cap of 3
    // on the base plan must NOT flag this org.
    await createSubscription(orgA, "pro", {
      id: "sub-override",
      planId: "pro",
      overrides: { limits: { maxMembers: 50 } },
    });

    // Unrelated org on pro with no override and 20 members → should be flagged.
    const { id: orgB } = await createOrgOnPlan("pro", {
      id: "org-plain",
      memberIds: Array.from({ length: 20 }, (_, i) => `n${i}`),
    });
    await createSubscription(orgB, "pro", { id: "sub-plain", planId: "pro" });

    const preview = await planService.previewChange(
      "pro",
      { limits: { maxEvents: 99, maxParticipantsPerEvent: 2000, maxMembers: 3 } },
      admin,
    );

    expect(preview.totalScanned).toBe(2);
    const withOverride = preview.affected.find((a) => a.orgId === "org-override")!;
    expect(withOverride.violations.some((v) => v.includes("membres"))).toBe(false);
    const plain = preview.affected.find((a) => a.orgId === "org-plain")!;
    expect(plain.violations.some((v) => v.includes("membres"))).toBe(true);
  });

  it("display-only changes short-circuit — no scan, no banner", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("pro");
    await createSubscription(orgId, "pro", { id: `sub-${orgId}`, planId: "pro" });

    const preview = await planService.previewChange("pro", { sortOrder: 42 }, admin);

    expect(preview.willMintNewVersion).toBe(false);
    expect(preview.totalScanned).toBe(0);
    expect(preview.totalAffected).toBe(0);
    expect(preview.affected).toEqual([]);
  });

  it("feature removal flags orgs currently using the feature", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("pro");
    await createSubscription(orgId, "pro", { id: `sub-${orgId}`, planId: "pro" });

    // Pro has `smsNotifications: true`; removing it should flag this org.
    // The schema requires the full features object (admin UI always sends
    // it that way from form state), so we spread the pro tier's features
    // and flip one bit.
    const preview = await planService.previewChange(
      "pro",
      {
        features: {
          qrScanning: true,
          paidTickets: true,
          customBadges: true,
          csvExport: true,
          smsNotifications: false,
          advancedAnalytics: true,
          speakerPortal: true,
          sponsorPortal: true,
          apiAccess: false,
          whiteLabel: false,
          promoCodes: true,
        },
      },
      admin,
    );

    const affected = preview.affected[0]!;
    // The server maps the camelCase key to its French label so operators
    // see "Notifications SMS", not "smsNotifications".
    expect(affected.violations.some((v) => v.includes("Notifications SMS"))).toBe(true);
  });

  it("scans the whole lineage — orgs pinned to v1 are surfaced when editing v2", async () => {
    const admin = buildSuperAdmin();
    // Org 1 is pinned to pro@v1.
    const { id: orgV1 } = await createOrgOnPlan("pro", {
      id: "org-v1",
      memberIds: Array.from({ length: 10 }, (_, i) => `v1-${i}`),
    });
    await createSubscription(orgV1, "pro", { id: "sub-v1", planId: "pro" });

    // Mint pro@v2 via a legitimate edit.
    const v2 = await planService.update("pro", { priceXof: 34_900 }, admin);
    expect(v2.version).toBe(2);

    // Org 2 signs up and pins to v2.
    const { id: orgV2 } = await createOrgOnPlan("pro", {
      id: "org-v2",
      memberIds: Array.from({ length: 10 }, (_, i) => `v2-${i}`),
    });
    await createSubscription(orgV2, "pro", { id: "sub-v2", planId: v2.id });

    // Now preview an edit on v2 that would tighten maxMembers to 3. Both
    // orgs have 10 members — both should surface with correct
    // `currentVersion` labels so the admin knows the cohort split.
    const preview = await planService.previewChange(
      v2.id,
      { limits: { maxEvents: 99, maxParticipantsPerEvent: 2000, maxMembers: 3 } },
      admin,
    );

    expect(preview.totalScanned).toBe(2);
    expect(preview.totalAffected).toBe(2);
    const fromV1 = preview.affected.find((a) => a.orgId === "org-v1")!;
    const fromV2 = preview.affected.find((a) => a.orgId === "org-v2")!;
    expect(fromV1.currentVersion).toBe(1);
    expect(fromV2.currentVersion).toBe(2);
  });

  it("preview does NOT mutate the catalog", async () => {
    const admin = buildSuperAdmin();
    const before = await db.collection(COLLECTIONS.PLANS).doc("pro").get();

    await planService.previewChange(
      "pro",
      { priceXof: 34_900, limits: { maxEvents: 1, maxParticipantsPerEvent: 1, maxMembers: 1 } },
      admin,
    );

    const after = await db.collection(COLLECTIONS.PLANS).doc("pro").get();
    expect(after.data()?.priceXof).toBe(before.data()?.priceXof);
    expect(after.data()?.limits).toEqual(before.data()?.limits);
    expect(after.data()?.version).toBe(before.data()?.version);
  });
});
