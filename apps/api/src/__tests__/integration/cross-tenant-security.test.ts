import { describe, it, expect, beforeEach } from "vitest";
import { eventService } from "@/services/event.service";
import { registrationService } from "@/services/registration.service";
import { checkinService } from "@/services/checkin.service";
import { ForbiddenError } from "@/errors/app-error";
import { buildOrganizerUser, buildStaffUser, buildSuperAdmin } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  createRegistration,
  readEvent,
} from "./helpers";

/**
 * Regression coverage for multi-tenant isolation — the single most
 * important security invariant in the platform. Every service method
 * that accesses org-scoped data must call `requireOrganizationAccess`,
 * and `super_admin` must cleanly bypass it.
 *
 * A bug here is a customer-impacting data leak, so we verify the cross-
 * tenant contract at the service layer directly (bypassing route-level
 * auth) to prove the deep checks exist.
 */
describe("Integration: cross-tenant security", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("organizer A cannot update an event owned by organization B", async () => {
    const { id: orgA } = await createOrgOnPlan("starter", { id: "org-a" });
    const { id: orgB } = await createOrgOnPlan("starter", { id: "org-b" });
    const eventOnB = await createEvent(orgB, { title: "B's event" });
    const organizerA = buildOrganizerUser(orgA);

    await expect(
      eventService.update(eventOnB.id, { title: "Hijacked" }, organizerA),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Event title untouched.
    expect((await readEvent(eventOnB.id))?.title).toBe("B's event");
  });

  it("organizer A cannot cancel / publish an event owned by organization B", async () => {
    const { id: orgA } = await createOrgOnPlan("starter", { id: "org-a" });
    const { id: orgB } = await createOrgOnPlan("starter", { id: "org-b" });
    const draftOnB = await createEvent(orgB, {
      status: "draft",
      publishedAt: null,
      title: "B draft",
    });
    const organizerA = buildOrganizerUser(orgA);

    await expect(eventService.cancel(draftOnB.id, organizerA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(eventService.publish(draftOnB.id, organizerA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await readEvent(draftOnB.id))?.status).toBe("draft");
  });

  it("staff scoped to org A cannot scan check-ins at an event hosted by org B", async () => {
    const { id: orgA } = await createOrgOnPlan("starter", { id: "org-a" });
    const { id: orgB } = await createOrgOnPlan("starter", { id: "org-b" });
    const eventOnB = await createEvent(orgB);
    const regOnB = await createRegistration(eventOnB.id, "user-on-b");
    const staffA = buildStaffUser({ organizationId: orgA });

    // bulkSync checks organization access BEFORE looping items, so we
    // expect a thrown ForbiddenError (not a per-item failure).
    await expect(
      checkinService.bulkSync(
        eventOnB.id,
        [
          {
            localId: "x",
            qrCodeValue: regOnB.qrCodeValue,
            scannedAt: new Date().toISOString(),
          },
        ],
        staffA,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("super_admin bypasses the organization-access check for cross-org ops", async () => {
    const { id: orgB } = await createOrgOnPlan("starter", { id: "org-b" });
    const draftOnB = await createEvent(orgB, {
      status: "draft",
      publishedAt: null,
    });
    const admin = buildSuperAdmin();

    // Admin has no organizationId, yet can publish + update any event.
    await eventService.update(draftOnB.id, { title: "Renamed by admin" }, admin);
    await eventService.publish(draftOnB.id, admin);

    const after = await readEvent(draftOnB.id);
    expect(after?.title).toBe("Renamed by admin");
    expect(after?.status).toBe("published");
  });

  it("a participant cannot cancel someone else's registration", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const { buildAuthUser } = await import("@/__tests__/factories");
    const owner = buildAuthUser();
    const attacker = buildAuthUser();

    const reg = await registrationService.register(event.id, "t1", owner);

    // Attacker lacks `registration:cancel_any` — only the owner can cancel
    // their own registration. Expect ForbiddenError.
    await expect(registrationService.cancel(reg.id, attacker)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
