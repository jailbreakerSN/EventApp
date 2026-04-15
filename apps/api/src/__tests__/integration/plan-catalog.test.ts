import { describe, it, expect, beforeEach } from "vitest";
import { planService } from "@/services/plan.service";
import { buildSuperAdmin, buildAuthUser } from "@/__tests__/factories";
import { ForbiddenError, ConflictError } from "@/errors/app-error";
import { clearFirestore, seedSystemPlans, readPlan } from "./helpers";

/**
 * Scenario 1 (Phase 7+ roadmap, exit criterion #1): "Superadmin creates a
 * custom plan → backend + DB in sync."
 *
 * Exercises the full stack: service → repository → Firestore emulator.
 * No mocks. Assertions read the plan back from the emulator to prove the
 * write actually hit the DB and the service response matches.
 */
describe("Integration: plan catalog CRUD", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("superadmin creates a custom plan and it persists in Firestore", async () => {
    const admin = buildSuperAdmin();

    const created = await planService.create(
      {
        key: "custom_acme_2026",
        name: { fr: "Acme Sur Mesure", en: "Acme Custom" },
        description: { fr: "Deal bespoke pour Acme", en: "Bespoke deal for Acme" },
        pricingModel: "fixed",
        priceXof: 49900,
        limits: { maxEvents: 999, maxParticipantsPerEvent: 5000, maxMembers: 20 },
        features: {
          qrScanning: true,
          paidTickets: true,
          customBadges: true,
          csvExport: true,
          smsNotifications: true,
          advancedAnalytics: true,
          speakerPortal: true,
          sponsorPortal: true,
          apiAccess: false,
          whiteLabel: false,
          promoCodes: true,
        },
        isPublic: false,
        sortOrder: 99,
      },
      admin,
    );

    expect(created.key).toBe("custom_acme_2026");
    expect(created.isSystem).toBe(false);
    expect(created.isArchived).toBe(false);
    expect(created.priceXof).toBe(49900);

    const persisted = await readPlan(created.id);
    expect(persisted).not.toBeNull();
    expect(persisted?.key).toBe("custom_acme_2026");
    expect(persisted?.limits.maxEvents).toBe(999);
    expect(persisted?.features.smsNotifications).toBe(true);
    expect(persisted?.createdBy).toBe(admin.uid);
  });

  it("rejects duplicate key with ConflictError", async () => {
    const admin = buildSuperAdmin();
    const baseDto = {
      key: "dup_key",
      name: { fr: "Dup", en: "Dup" },
      pricingModel: "fixed" as const,
      priceXof: 1000,
      limits: { maxEvents: 1, maxParticipantsPerEvent: 1, maxMembers: 1 },
      features: {
        qrScanning: false,
        paidTickets: false,
        customBadges: false,
        csvExport: false,
        smsNotifications: false,
        advancedAnalytics: false,
        speakerPortal: false,
        sponsorPortal: false,
        apiAccess: false,
        whiteLabel: false,
        promoCodes: false,
      },
      isPublic: true,
      sortOrder: 10,
    };
    await planService.create(baseDto, admin);
    await expect(planService.create(baseDto, admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it("forbids non-super-admin from creating plans", async () => {
    const organizer = buildAuthUser({ roles: ["organizer"], organizationId: "org-x" });
    await expect(
      planService.create(
        {
          key: "should_not_persist",
          name: { fr: "X", en: "X" },
          pricingModel: "fixed",
          priceXof: 1000,
          limits: { maxEvents: 1, maxParticipantsPerEvent: 1, maxMembers: 1 },
          features: {
            qrScanning: false,
            paidTickets: false,
            customBadges: false,
            csvExport: false,
            smsNotifications: false,
            advancedAnalytics: false,
            speakerPortal: false,
            sponsorPortal: false,
            apiAccess: false,
            whiteLabel: false,
            promoCodes: false,
          },
          isPublic: true,
          sortOrder: 10,
        },
        organizer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("public catalog excludes archived + private plans", async () => {
    const admin = buildSuperAdmin();

    // Private custom plan (one-off deal) — should NOT appear in the public catalog.
    await planService.create(
      {
        key: "private_deal",
        name: { fr: "Privé", en: "Private" },
        pricingModel: "fixed",
        priceXof: 9999,
        limits: { maxEvents: 10, maxParticipantsPerEvent: 100, maxMembers: 5 },
        features: {
          qrScanning: true,
          paidTickets: false,
          customBadges: false,
          csvExport: false,
          smsNotifications: false,
          advancedAnalytics: false,
          speakerPortal: false,
          sponsorPortal: false,
          apiAccess: false,
          whiteLabel: false,
          promoCodes: false,
        },
        isPublic: false,
        sortOrder: 20,
      },
      admin,
    );

    const publicCatalog = await planService.getPublicCatalog();
    const publicKeys = publicCatalog.map((p) => p.key).sort();
    // Four system plans are public; the custom private plan is excluded.
    expect(publicKeys).toEqual(["enterprise", "free", "pro", "starter"]);
  });
});
