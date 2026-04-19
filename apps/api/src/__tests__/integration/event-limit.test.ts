import { describe, it, expect, beforeEach } from "vitest";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventService } from "@/services/event.service";
import { subscriptionService } from "@/services/subscription.service";
import { PlanLimitError } from "@/errors/app-error";
import { buildOrganizerUser, buildSuperAdmin, buildEvent } from "@/__tests__/factories";
import { clearFirestore, seedSystemPlans, createOrgOnPlan, readOrg } from "./helpers";

/**
 * Scenario 3 (Phase 7+ roadmap, exit criterion #3): "Organizer hits
 * `maxEvents` → `PlanLimitError`; raise override → can create another event."
 *
 * This is the most important end-to-end test: it proves that the whole
 * dynamic-plan pipeline (catalog → effective-limits denormalization →
 * BaseService.checkPlanLimit → service-layer enforcement) is wired
 * together correctly. A bug anywhere in that chain surfaces here.
 */
describe("Integration: event creation respects dynamic plan limits", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("blocks the 4th event on the free plan, then unblocks after admin raises maxEvents", async () => {
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("free");
    const organizer = buildOrganizerUser(orgId);

    // Pre-populate 3 active events (the free plan ceiling). Write raw docs
    // bypassing the service so we're not testing the service limit check
    // mid-seed.
    const batch = db.batch();
    for (let i = 0; i < 3; i++) {
      const event = buildEvent({
        organizationId: orgId,
        status: "published",
        title: `Seeded Event ${i}`,
        slug: `seeded-${orgId}-${i}`,
      });
      batch.set(db.collection(COLLECTIONS.EVENTS).doc(event.id), event);
    }
    await batch.commit();

    // Attempt the 4th event — blocked.
    const dto = buildEventDto(orgId);
    await expect(eventService.create(dto, organizer)).rejects.toBeInstanceOf(PlanLimitError);

    // Admin assigns the free plan WITH an override lifting maxEvents to 10.
    await subscriptionService.assignPlan(
      orgId,
      { planId: "free", overrides: { limits: { maxEvents: 10 } } },
      admin,
    );

    // Sanity check: the override was denormalised onto the org doc.
    const org = await readOrg(orgId);
    expect(org.effectiveLimits?.maxEvents).toBe(10);

    // Now the 4th event goes through — no error, real event written.
    const created = await eventService.create(buildEventDto(orgId), organizer);
    expect(created.organizationId).toBe(orgId);
    expect(created.status).toBe("draft"); // default — dto doesn't publish it
  });

  it("uses the denormalised snapshot, not the plan enum, when deciding the limit", async () => {
    // Org sits on the starter tier (maxEvents 10) but has a custom override
    // clamping it to 1. The service-layer enforcement must honour the
    // override, not the enum fallback.
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("starter");
    const organizer = buildOrganizerUser(orgId);

    await subscriptionService.assignPlan(
      orgId,
      { planId: "starter", overrides: { limits: { maxEvents: 1 } } },
      admin,
    );

    const first = await eventService.create(buildEventDto(orgId), organizer);
    expect(first.organizationId).toBe(orgId);

    // Second creation trips the override, not the starter-tier ceiling.
    await expect(eventService.create(buildEventDto(orgId), organizer)).rejects.toBeInstanceOf(
      PlanLimitError,
    );
  });
});

// ── DTO helper ──────────────────────────────────────────────────────────────

function buildEventDto(orgId: string) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  return {
    organizationId: orgId,
    title: `Integration Event ${Math.random().toString(36).slice(2, 8)}`,
    description: "Created by the integration suite",
    category: "conference" as const,
    tags: [],
    format: "in_person" as const,
    status: "draft" as const,
    location: { name: "Venue", address: "123 Rue", city: "Dakar", country: "SN" },
    startDate: tomorrow,
    endDate: nextWeek,
    timezone: "Africa/Dakar",
    ticketTypes: [],
    accessZones: [],
    maxAttendees: 100,
    isPublic: true,
    isFeatured: false,
    venueId: null,
    venueName: null,
    requiresApproval: false,
    templateId: null,
  };
}
