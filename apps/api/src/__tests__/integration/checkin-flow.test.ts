import { describe, it, expect, beforeEach } from "vitest";
import { checkinService } from "@/services/checkin.service";
import { signQrPayload } from "@/services/qr-signing";
import { buildAuthUser, buildStaffUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  createRegistration,
  readEvent,
  readRegistration,
} from "./helpers";

/**
 * Regression coverage for the check-in hot path. The service uses
 * `db.runTransaction` to atomically flip `registration.status` AND
 * bump `event.checkedInCount`. A mocked unit test can't catch bugs
 * like reading `event.accessZones` after a write or counters
 * double-incrementing on a duplicate scan.
 *
 * The suite drives the production entrypoint (`checkinService.bulkSync`)
 * — same code path the mobile scanner + web check-in dashboard invoke.
 */
describe("Integration: check-in flow", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("scans a valid QR → marks registration checked_in + increments counter", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const participant = buildAuthUser();
    const staff = buildStaffUser({ organizationId: orgId });
    const reg = await createRegistration(event.id, participant.uid);

    const res = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "local-1",
          qrCodeValue: reg.qrCodeValue,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );

    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.results[0]!.status).toBe("success");

    expect((await readRegistration(reg.id))?.status).toBe("checked_in");
    expect((await readEvent(event.id))?.checkedInCount).toBe(1);
  });

  it("second scan of the same QR is idempotent — status already_checked_in, no double-increment", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const participant = buildAuthUser();
    const staff = buildStaffUser({ organizationId: orgId });
    const reg = await createRegistration(event.id, participant.uid);

    const ts = new Date().toISOString();
    await checkinService.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: reg.qrCodeValue, scannedAt: ts }],
      staff,
    );

    // Second scan — e.g. offline replay on another scanner.
    const second = await checkinService.bulkSync(
      event.id,
      [{ localId: "local-2", qrCodeValue: reg.qrCodeValue, scannedAt: ts }],
      staff,
    );

    expect(second.results[0]!.status).toBe("already_checked_in");
    // Counter was NOT double-incremented by the second scan.
    expect((await readEvent(event.id))?.checkedInCount).toBe(1);
  });

  it("rejects a tampered QR payload as invalid_qr", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const staff = buildStaffUser({ organizationId: orgId });

    // Valid signature for (regA, event, user), but we swap the last segment
    // so the HMAC no longer matches.
    const valid = signQrPayload(
      "reg-real",
      event.id,
      "user-real",
      Date.now() - 86_400_000,
      Date.now() + 365 * 86_400_000,
    );
    const tampered = valid.replace(/:[0-9a-f]+$/, ":deadbeefdeadbeefdeadbeefdeadbeef");

    const res = await checkinService.bulkSync(
      event.id,
      [{ localId: "local-1", qrCodeValue: tampered, scannedAt: new Date().toISOString() }],
      staff,
    );

    expect(res.results[0]!.status).toBe("invalid_qr");
    expect((await readEvent(event.id))?.checkedInCount).toBe(0);
  });

  it("QR signed for a different event → not_found (cross-event replay defence)", async () => {
    const { id: orgA } = await createOrgOnPlan("starter", { id: "org-a" });
    const { id: orgB } = await createOrgOnPlan("starter", { id: "org-b" });
    const eventA = await createEvent(orgA);
    const eventB = await createEvent(orgB);
    const staffA = buildStaffUser({ organizationId: orgA });

    // Registration lives on event B. Staff scans it at event A's gate.
    const regOnB = await createRegistration(eventB.id, "some-user");

    const res = await checkinService.bulkSync(
      eventA.id,
      [
        {
          localId: "local-1",
          qrCodeValue: regOnB.qrCodeValue,
          scannedAt: new Date().toISOString(),
        },
      ],
      staffA,
    );

    expect(res.results[0]!.status).toBe("not_found");
    // Neither event's counter moved.
    expect((await readEvent(eventA.id))?.checkedInCount).toBe(0);
    expect((await readEvent(eventB.id))?.checkedInCount).toBe(0);
  });

  it("bulk of mixed outcomes is fully processed — no short-circuit on failure", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const staff = buildStaffUser({ organizationId: orgId });
    const regA = await createRegistration(event.id, "user-a");
    const regB = await createRegistration(event.id, "user-b");

    const res = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "1",
          qrCodeValue: regA.qrCodeValue,
          scannedAt: new Date().toISOString(),
        },
        {
          localId: "2",
          qrCodeValue: "totally-bogus-payload",
          scannedAt: new Date().toISOString(),
        },
        {
          localId: "3",
          qrCodeValue: regB.qrCodeValue,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );

    expect(res.processed).toBe(3);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.results.map((r) => r.status)).toEqual(["success", "invalid_qr", "success"]);
    expect((await readEvent(event.id))?.checkedInCount).toBe(2);
  });

  it("QR whose signed validity window is fully in the past → expired (no check-in)", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const staff = buildStaffUser({ organizationId: orgId });

    // Window ended 48h ago — well outside the 2h clock-skew grace.
    const reg = await createRegistration(event.id, "user-a", {
      qrNotBefore: Date.now() - 72 * 60 * 60 * 1000,
      qrNotAfter: Date.now() - 48 * 60 * 60 * 1000,
    });

    const res = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "1",
          qrCodeValue: reg.qrCodeValue,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );

    expect(res.results[0].status).toBe("expired");
    expect((await readRegistration(reg.id))?.status).toBe("confirmed");
    expect((await readEvent(event.id))?.checkedInCount).toBe(0);
  });

  it("bulk sync rejects items whose scannedAt is too far in the future", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const staff = buildStaffUser({ organizationId: orgId });
    const reg = await createRegistration(event.id, "user-a");

    // Half a day in the future — well past the 2h clock-skew grace.
    const futureScan = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const res = await checkinService.bulkSync(
      event.id,
      [{ localId: "1", qrCodeValue: reg.qrCodeValue, scannedAt: futureScan }],
      staff,
    );

    expect(res.results[0].status).toBe("invalid_qr");
    expect((await readRegistration(reg.id))?.status).toBe("confirmed");
  });

  it("bulk sync rejects items whose scannedAt is older than the 7-day reconcile lag", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const staff = buildStaffUser({ organizationId: orgId });
    const reg = await createRegistration(event.id, "user-a");

    // 30 days ago — way beyond the 7-day reconcile ceiling.
    const staleScan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const res = await checkinService.bulkSync(
      event.id,
      [{ localId: "1", qrCodeValue: reg.qrCodeValue, scannedAt: staleScan }],
      staff,
    );

    expect(res.results[0].status).toBe("invalid_qr");
    expect((await readRegistration(reg.id))?.status).toBe("confirmed");
  });

  it("QR whose window opens in the future → not_yet_valid (no check-in)", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    const staff = buildStaffUser({ organizationId: orgId });

    // Window opens 48h from now — outside the 2h grace.
    const reg = await createRegistration(event.id, "user-a", {
      qrNotBefore: Date.now() + 48 * 60 * 60 * 1000,
      qrNotAfter: Date.now() + 72 * 60 * 60 * 1000,
    });

    const res = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "1",
          qrCodeValue: reg.qrCodeValue,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );

    expect(res.results[0].status).toBe("not_yet_valid");
    expect((await readRegistration(reg.id))?.status).toBe("confirmed");
    expect((await readEvent(event.id))?.checkedInCount).toBe(0);
  });
});
