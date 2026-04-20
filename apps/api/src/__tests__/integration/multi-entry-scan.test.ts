import { describe, it, expect, beforeEach } from "vitest";
import { eventService } from "@/services/event.service";
import { registrationService } from "@/services/registration.service";
import { buildAuthUser, buildStaffUser, buildOrganizerUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  readEvent,
} from "./helpers";
import { signQrPayloadV4, computeValidityWindow, generateEventKid } from "@/services/qr-signing";
import { db, COLLECTIONS } from "@/config/firebase";
import { QrAlreadyUsedError } from "@/errors/app-error";
import type { Registration } from "@teranga/shared-types";

/**
 * Integration coverage for the Sprint C 3.3 multi-entry scan-policy
 * journey. Under the default `"single"` policy a badge can only be
 * checked in once (the existing `checkin-flow.test.ts` locks that
 * down). When an organizer flips the event to `"multi_zone"`, the
 * same badge can be scanned once PER access-zone without tripping
 * the duplicate-scan path. `checkinLocks/{registrationId}:{scope}`
 * is the serialisation primitive.
 *
 * The invariants we care about:
 *   (I1) Under `"single"`, a second scan is `QrAlreadyUsedError`.
 *   (I2) Flipping policy to `"multi_zone"` requires the Pro plan
 *        feature `advancedAnalytics` (free / starter orgs get 403).
 *   (I3) Under `"multi_zone"`, scans at DIFFERENT zones succeed.
 *   (I4) Under `"multi_zone"`, a re-scan at the SAME zone is still a
 *        duplicate (zone-level lock, not global).
 *   (I5) `event.checkedInCount` = unique humans; per-zone counter
 *        under `zoneCheckedInCounts` counts throughput (every entry).
 */
describe("Integration: multi-entry scan policy (Sprint C 3.3)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  async function seedRegistration(
    eventId: string,
    participantUid: string,
    qrKid: string,
    startDate: string,
    endDate: string,
  ): Promise<{ reg: Registration; qr: string }> {
    const regId = `reg-${Math.random().toString(36).slice(2, 10)}`;
    const window = computeValidityWindow(startDate, endDate);
    const qr = signQrPayloadV4(
      regId,
      eventId,
      participantUid,
      window.notBefore,
      window.notAfter,
      qrKid,
    );
    const now = new Date().toISOString();
    const reg: Registration = {
      id: regId,
      eventId,
      userId: participantUid,
      ticketTypeId: "t1",
      status: "confirmed",
      qrCodeValue: qr,
      checkedInAt: null,
      checkedInBy: null,
      accessZoneId: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    } as Registration;
    await db.collection(COLLECTIONS.REGISTRATIONS).doc(regId).set(reg);
    return { reg, qr };
  }

  it("flip policy to multi_zone, scan same badge in two zones, both succeed", async () => {
    // Pro plan required — multi_zone is gated behind `advancedAnalytics`.
    const { id: orgId } = await createOrgOnPlan("pro");
    const qrKid = generateEventKid();
    const event = await createEvent(orgId, {
      qrKid,
      qrKidHistory: [],
      scanPolicy: "single",
      accessZones: [
        {
          id: "zone-entrance",
          name: "Entrée",
          color: "#000000",
          allowedTicketTypes: ["t1"],
          capacity: null,
        },
        {
          id: "zone-vip",
          name: "VIP",
          color: "#FFD700",
          allowedTicketTypes: ["t1"],
          capacity: null,
        },
      ],
    });

    const organizer = buildOrganizerUser(orgId);
    const participant = buildAuthUser();
    const staff = buildStaffUser({ organizationId: orgId });

    const { qr } = await seedRegistration(
      event.id,
      participant.uid,
      qrKid,
      event.startDate,
      event.endDate,
    );

    // ── I1: under default single policy, zone-entrance scan ok, second rejected ──
    const firstScan = await registrationService.checkIn(qr, staff, {
      accessZoneId: "zone-entrance",
    });
    expect(firstScan.valid).toBe(true);

    await expect(
      registrationService.checkIn(qr, staff, { accessZoneId: "zone-entrance" }),
    ).rejects.toBeInstanceOf(QrAlreadyUsedError);

    // ── Flip policy to multi_zone ──
    const policyResult = await eventService.setScanPolicy(event.id, "multi_zone", organizer);
    expect(policyResult.scanPolicy).toBe("multi_zone");

    const afterFlip = await readEvent(event.id);
    expect(afterFlip?.scanPolicy).toBe("multi_zone");

    // ── Seed a SECOND registration — the first one already flipped to
    // checked_in, which is a terminal state for the live path. The
    // multi_zone semantics apply to brand-new registrations going
    // forward, so we exercise the policy on a fresh badge.
    const second = await seedRegistration(
      event.id,
      `${participant.uid}-bis`,
      qrKid,
      event.startDate,
      event.endDate,
    );

    // ── I3: scan at zone-entrance, then zone-vip → both succeed ──
    const entranceScan = await registrationService.checkIn(second.qr, staff, {
      accessZoneId: "zone-entrance",
    });
    expect(entranceScan.valid).toBe(true);

    const vipScan = await registrationService.checkIn(second.qr, staff, {
      accessZoneId: "zone-vip",
    });
    expect(vipScan.valid).toBe(true);

    // ── I4: re-scan at zone-entrance → duplicate (zone-level lock)
    await expect(
      registrationService.checkIn(second.qr, staff, { accessZoneId: "zone-entrance" }),
    ).rejects.toBeInstanceOf(QrAlreadyUsedError);
  });

  it("non-pro plan cannot flip scanPolicy to multi_zone (plan-feature gate)", async () => {
    const { id: orgId } = await createOrgOnPlan("starter"); // starter lacks advancedAnalytics
    const qrKid = generateEventKid();
    const event = await createEvent(orgId, { qrKid, qrKidHistory: [], scanPolicy: "single" });
    const organizer = buildOrganizerUser(orgId);

    await expect(eventService.setScanPolicy(event.id, "multi_zone", organizer)).rejects.toThrow(
      /advancedAnalytics|plan/i,
    );

    // Step-down flips back to "single" remain allowed from any plan so
    // a downgraded org can always revert a previously-set multi policy.
    await expect(eventService.setScanPolicy(event.id, "single", organizer)).resolves.toMatchObject({
      scanPolicy: "single",
    });
  });
});
