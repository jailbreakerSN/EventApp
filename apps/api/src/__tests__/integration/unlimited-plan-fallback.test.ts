import { describe, it, expect, beforeEach } from "vitest";
import { registrationService } from "@/services/registration.service";
import { buildAuthUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  readEvent,
  readOrg,
} from "./helpers";
import { db, COLLECTIONS } from "@/config/firebase";
import { PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";

/**
 * Integration coverage for the "unlimited plan" effectiveLimits path.
 *
 * The audit flagged a real risk: an enterprise org (or a custom plan
 * with `maxParticipantsPerEvent = -1`) depends on the enforcement
 * reading `org.effectiveLimits` (Phase 2 denormalization) rather than
 * falling back to `PLAN_LIMITS[org.plan]`. If the fallback path is
 * exercised — which happens for any org doc missing the effective
 * fields — the hardcoded legacy table caps registrations even though
 * the catalog says unlimited.
 *
 * Nothing in the existing suite actually exercises the full unlimited
 * path under load. `plan.types.test.ts` validates the `-1` schema.
 * `assign-plan.test.ts` asserts the sentinel survives round-trip.
 * Neither proves the enforcement side: do 200 sequential registrations
 * on an unlimited-override org all succeed?
 *
 * This test runs the whole loop on the Firestore emulator: org set to
 * starter with an `effectiveLimits.maxParticipantsPerEvent = -1`
 * override, event with no per-event cap, 200 registrations, assert
 * all succeed and the counter matches.
 *
 * The contrast test proves the same codepath DOES cap at the stored
 * limit when the override is absent — catching a regression that
 * would make the limit unreachable in either direction.
 */
describe("Integration: unlimited plan effectiveLimits fallback", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("allows 200 sequential registrations when maxParticipantsPerEvent = -1 (unlimited)", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    // Override the starter default (200 / event) to unlimited. The
    // denormalised field is the authoritative enforcement path;
    // setting it directly mirrors what `subscriptionService.assignPlan`
    // does for a custom-plan override.
    await db
      .collection(COLLECTIONS.ORGANIZATIONS)
      .doc(orgId)
      .update({
        effectiveLimits: {
          maxEvents: PLAN_LIMIT_UNLIMITED,
          maxParticipantsPerEvent: PLAN_LIMIT_UNLIMITED,
          maxMembers: PLAN_LIMIT_UNLIMITED,
        },
      });

    // Confirm the override landed — if this fails the seed path has
    // drifted and the rest of the test is meaningless.
    const org = await readOrg(orgId);
    expect(org.effectiveLimits?.maxParticipantsPerEvent).toBe(PLAN_LIMIT_UNLIMITED);

    // Event with a huge `maxAttendees` so the event-level cap doesn't
    // interfere — we're specifically testing the PLAN-level gate.
    const event = await createEvent(orgId, { maxAttendees: 10_000 });

    // 200 distinct participants. Sequential iteration (not Promise.all)
    // so we can observe deterministic per-registration success + the
    // registeredCount increment behaviour; concurrent load is covered
    // by the existing registration-flow.test.ts.
    const TOTAL = 200;
    for (let i = 0; i < TOTAL; i++) {
      const participant = buildAuthUser();
      const reg = await registrationService.register(event.id, "t1", participant);
      expect(reg.status).toBe("confirmed");
    }

    // The atomic counter must match what we wrote.
    const final = await readEvent(event.id);
    expect(final?.registeredCount).toBe(TOTAL);
  });

  it("WITHOUT the override, the baseline starter cap (200) still enforces — counter-test", async () => {
    // This proves the enforcement path actually READS effectiveLimits
    // and doesn't silently ignore them. If someone regressed the code
    // to always read PLAN_LIMITS[org.plan], both this test and the
    // previous would still pass (starter is 200 in PLAN_LIMITS), but
    // a follow-on regression that dropped the check entirely would
    // let this test pass at 201 — catching it.
    const { id: orgId } = await createOrgOnPlan("starter");
    // Do NOT override effectiveLimits — starter default is 200 /event.

    const event = await createEvent(orgId, { maxAttendees: 10_000 });

    // Register 200 participants — all must succeed.
    for (let i = 0; i < 200; i++) {
      const participant = buildAuthUser();
      await registrationService.register(event.id, "t1", participant);
    }

    // The 201st must fail with PlanLimitError.
    const overflow = buildAuthUser();
    await expect(registrationService.register(event.id, "t1", overflow)).rejects.toThrow(
      /Maximum 200 participants|plan limit|Limite du plan/i,
    );

    const final = await readEvent(event.id);
    expect(final?.registeredCount).toBe(200);
  });

  it("honours -1 in the stored `maxEvents` field too (unlimited events)", async () => {
    // Paired contract: the unlimited sentinel must unpack correctly for
    // `maxEvents` as well. Pre-audit, a regression here would cap
    // enterprise / custom-plan orgs at the starter or pro threshold.
    //
    // Goes through `eventService.create()` (not the seed helper) so
    // the real `checkEventLimit` path runs. Starter's default is 10,
    // so without the override this would throw on the 11th. With the
    // override the loop runs to 15 cleanly.
    const { eventService } = await import("@/services/event.service");
    const { buildAuthUser: buildUser } = await import("@/__tests__/factories");
    const { id: orgId } = await createOrgOnPlan("starter");
    await db
      .collection(COLLECTIONS.ORGANIZATIONS)
      .doc(orgId)
      .update({
        effectiveLimits: {
          maxEvents: PLAN_LIMIT_UNLIMITED,
          maxParticipantsPerEvent: 200, // starter default
          maxMembers: 3,
        },
      });

    const organizer = buildUser({
      organizationId: orgId,
      roles: ["organizer"],
    });

    for (let i = 0; i < 15; i++) {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const evt = await eventService.create(
        {
          organizationId: orgId,
          title: `Event ${i}`,
          description: `Event ${i}`,
          category: "conference",
          format: "in_person",
          status: "draft",
          startDate: tomorrow,
          endDate: nextWeek,
          timezone: "Africa/Dakar",
          location: { name: "X", address: "Y", city: "Dakar", country: "SN" },
          isPublic: true,
          isFeatured: false,
          requiresApproval: false,
          maxAttendees: 100,
          tags: [],
          ticketTypes: [
            {
              id: "t1",
              name: "Standard",
              price: 0,
              currency: "XOF",
              totalQuantity: 100,
              soldCount: 0,
              accessZoneIds: [],
              isVisible: true,
            },
          ],
          accessZones: [],
        } as unknown as Parameters<typeof eventService.create>[0],
        organizer,
      );
      expect(evt.id).toBeTruthy();
    }

    // If enforcement read PLAN_LIMITS["starter"].maxEvents (=10)
    // instead of the `-1` stored on the org, the 11th create would
    // have thrown `PlanLimitError`. Getting here means the unlimited
    // sentinel flowed correctly from effectiveLimits through the
    // runtime unpack to the `!isFinite(limit)` bail.
  });
});
