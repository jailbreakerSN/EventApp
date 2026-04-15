import { describe, it, expect, beforeEach } from "vitest";
import { registrationService } from "@/services/registration.service";
import { subscriptionService } from "@/services/subscription.service";
import { ConflictError, PlanLimitError, RegistrationClosedError } from "@/errors/app-error";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  readEvent,
  readRegistration,
} from "./helpers";

/**
 * Regression coverage for the core participant transaction: register →
 * counter increment → (later) cancel → counter decrement. Every mutation
 * lives inside `db.runTransaction`, so this is the kind of test where a
 * mocked unit test will miss real Firestore behaviour (e.g. read-after-
 * write ordering, FieldValue.increment arithmetic under contention).
 *
 * Also exercises the effective-plan enforcement path: dropping the
 * `maxParticipantsPerEvent` override to 1 should make the second
 * registration fail, proving the denormalised snapshot flows all the
 * way into the transactional read.
 */
describe("Integration: registration flow", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("registers a participant, increments the counter, signs a valid QR", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const participant = buildAuthUser();

    const reg = await registrationService.register(event.id, "t1", participant);

    expect(reg.eventId).toBe(event.id);
    expect(reg.userId).toBe(participant.uid);
    expect(reg.status).toBe("confirmed");
    // v2 QR payload: regId:eventId:userId:epochBase36:hmacHex
    expect(reg.qrCodeValue.split(":")).toHaveLength(5);

    const after = await readEvent(event.id);
    expect(after?.registeredCount).toBe(1);
  });

  it("rejects a duplicate registration for the same user with ConflictError", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const participant = buildAuthUser();

    await registrationService.register(event.id, "t1", participant);
    await expect(registrationService.register(event.id, "t1", participant)).rejects.toBeInstanceOf(
      ConflictError,
    );

    // Counter must not have been double-incremented.
    const after = await readEvent(event.id);
    expect(after?.registeredCount).toBe(1);
  });

  it("decrements registeredCount when a confirmed registration is cancelled", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const a = buildAuthUser();
    const b = buildAuthUser();

    const regA = await registrationService.register(event.id, "t1", a);
    await registrationService.register(event.id, "t1", b);
    expect((await readEvent(event.id))?.registeredCount).toBe(2);

    await registrationService.cancel(regA.id, a);

    expect((await readEvent(event.id))?.registeredCount).toBe(1);
    expect((await readRegistration(regA.id))?.status).toBe("cancelled");
  });

  it("enforces the per-event participant limit from the effective snapshot", async () => {
    // Put the org on starter then clamp `maxParticipantsPerEvent` to 1 via
    // an admin override. Phase 3 enforcement reads the denormalised field
    // so the very next attempt should throw even though the starter tier
    // normally allows 200.
    const admin = buildSuperAdmin();
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);

    await subscriptionService.assignPlan(
      orgId,
      {
        planId: "starter",
        overrides: { limits: { maxParticipantsPerEvent: 1 } },
      },
      admin,
    );

    const first = buildAuthUser();
    const second = buildAuthUser();

    await registrationService.register(event.id, "t1", first);
    await expect(registrationService.register(event.id, "t1", second)).rejects.toBeInstanceOf(
      PlanLimitError,
    );

    // Counter must reflect the successful registration only.
    const after = await readEvent(event.id);
    expect(after?.registeredCount).toBe(1);
  });

  it("refuses registration for an unpublished (draft) event", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId, { status: "draft", publishedAt: null });
    const participant = buildAuthUser();

    await expect(registrationService.register(event.id, "t1", participant)).rejects.toBeInstanceOf(
      RegistrationClosedError,
    );

    expect((await readEvent(event.id))?.registeredCount).toBe(0);
  });
});
