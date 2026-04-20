import { describe, it, expect, beforeEach } from "vitest";
import { eventService } from "@/services/event.service";
import { checkinService } from "@/services/checkin.service";
import { buildAuthUser, buildStaffUser, buildOrganizerUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  readEvent,
} from "./helpers";
import {
  signQrPayloadV4,
  computeValidityWindow,
  generateEventKid,
  deriveEventKey,
  hmacSignWithKey,
} from "@/services/qr-signing";
import { db, COLLECTIONS } from "@/config/firebase";
import type { Registration } from "@teranga/shared-types";

/**
 * Integration coverage for the Sprint B 1.1 + 1.2 QR-key rotation
 * journey. The guarantee we need to lock in: rotating an event's
 * signing key does NOT invalidate already-issued badges. A badge
 * signed against the PREVIOUS `qrKid` must still verify after the
 * rotation, because that kid lives on in `qrKidHistory` until it's
 * explicitly expired.
 *
 * Why emulator-backed rather than unit-mocked:
 *   - The rotation runs inside `db.runTransaction` → this exercises
 *     the real read-before-write ordering.
 *   - The verification path reads `event.qrKid` + `event.qrKidHistory`
 *     back from Firestore via `resolveEventKeyFromEvent` — mocked
 *     shapes can drift from the stored doc without anyone noticing.
 *   - The HKDF key derivation (QR_MASTER × eventId × kid) must be
 *     deterministic across both the signer and verifier paths. A
 *     silent regression in one side breaks every scanner.
 *
 * Covered invariants:
 *   (I1) Pre-rotation badge verifies.
 *   (I2) Post-rotation, an OLD badge still verifies (history window).
 *   (I3) Post-rotation, a NEW badge signed with the new kid verifies.
 *   (I4) A badge signed with a kid that was never on this event
 *        (nor in history) is rejected.
 */
describe("Integration: QR-key rotation journey (Sprint B 1.1 + 1.2)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("pre- and post-rotation badges both verify on scan", async () => {
    // ── Setup ────────────────────────────────────────────────────────────
    const { id: orgId } = await createOrgOnPlan("starter"); // starter has qrScanning
    const initialKid = generateEventKid();
    const event = await createEvent(orgId, { qrKid: initialKid, qrKidHistory: [] });

    const organizer = buildOrganizerUser(orgId);
    const participant = buildAuthUser();
    const staff = buildStaffUser({ organizationId: orgId });

    // ── Issue a badge BEFORE rotation ───────────────────────────────────
    const preRegistrationId = "reg-pre-rotation";
    const window = computeValidityWindow(event.startDate, event.endDate);
    const preQr = signQrPayloadV4(
      preRegistrationId,
      event.id,
      participant.uid,
      window.notBefore,
      window.notAfter,
      initialKid,
    );
    await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .doc(preRegistrationId)
      .set({
        id: preRegistrationId,
        eventId: event.id,
        userId: participant.uid,
        ticketTypeId: "t1",
        status: "confirmed",
        qrCodeValue: preQr,
        checkedInAt: null,
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies Registration);

    // ── I1: pre-rotation scan succeeds ──────────────────────────────────
    const preScan = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "local-pre-1",
          qrCodeValue: preQr,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );
    expect(preScan.succeeded).toBe(1);
    expect(preScan.results[0].status).toBe("success");

    // ── Rotate the key ───────────────────────────────────────────────────
    const rotation = await eventService.rotateQrKey(event.id, organizer);
    expect(rotation.qrKid).not.toBe(initialKid);
    const newKid = rotation.qrKid;

    const afterRotation = await readEvent(event.id);
    expect(afterRotation?.qrKid).toBe(newKid);
    expect(afterRotation?.qrKidHistory).toHaveLength(1);
    expect(afterRotation?.qrKidHistory?.[0]).toMatchObject({ kid: initialKid });

    // ── I2: post-rotation, OLD badge still verifies ─────────────────────
    // Issue a second registration signed with the retired kid — the
    // staff flow must still accept it because `qrKidHistory` holds it.
    const historyRegId = "reg-history-badge";
    const historyQr = signQrPayloadV4(
      historyRegId,
      event.id,
      participant.uid,
      window.notBefore,
      window.notAfter,
      initialKid, // ← signed with the RETIRED kid
    );
    await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .doc(historyRegId)
      .set({
        id: historyRegId,
        eventId: event.id,
        userId: `${participant.uid}-bis`, // different user so no duplicate check
        ticketTypeId: "t1",
        status: "confirmed",
        qrCodeValue: historyQr,
        checkedInAt: null,
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies Registration);

    const historyScan = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "local-history-1",
          qrCodeValue: historyQr,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );
    expect(historyScan.succeeded).toBe(1);
    expect(historyScan.results[0].status).toBe("success");

    // ── I3: new badge signed with the NEW kid verifies ──────────────────
    const newRegId = "reg-post-rotation";
    const newQr = signQrPayloadV4(
      newRegId,
      event.id,
      `${participant.uid}-ter`,
      window.notBefore,
      window.notAfter,
      newKid,
    );
    await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .doc(newRegId)
      .set({
        id: newRegId,
        eventId: event.id,
        userId: `${participant.uid}-ter`,
        ticketTypeId: "t1",
        status: "confirmed",
        qrCodeValue: newQr,
        checkedInAt: null,
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies Registration);

    const newScan = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "local-post-1",
          qrCodeValue: newQr,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );
    expect(newScan.succeeded).toBe(1);
    expect(newScan.results[0].status).toBe("success");
  });

  it("a kid that was never on this event is rejected (forged payload)", async () => {
    const { id: orgId } = await createOrgOnPlan("starter");
    const eventKid = generateEventKid();
    const event = await createEvent(orgId, { qrKid: eventKid, qrKidHistory: [] });
    const participant = buildAuthUser();
    const staff = buildStaffUser({ organizationId: orgId });

    // Sign with a VALID HMAC but a kid the event has never seen. The
    // verifier resolves kid → key via the event's `qrKid` / history;
    // an unknown kid means no key → signature rejected.
    const unknownKid = generateEventKid();
    const window = computeValidityWindow(event.startDate, event.endDate);
    const forgedPayload = signQrPayloadV4(
      "reg-forged",
      event.id,
      participant.uid,
      window.notBefore,
      window.notAfter,
      unknownKid,
    );

    // The forged badge also needs a matching registration doc for the
    // lookup path to reach the verifier — otherwise we'd fail at
    // `findByQrCode` for the wrong reason. Seed one so the rejection
    // comes from the kid resolver, not a missing row.
    await db
      .collection(COLLECTIONS.REGISTRATIONS)
      .doc("reg-forged")
      .set({
        id: "reg-forged",
        eventId: event.id,
        userId: participant.uid,
        ticketTypeId: "t1",
        status: "confirmed",
        qrCodeValue: forgedPayload,
        checkedInAt: null,
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies Registration);

    const result = await checkinService.bulkSync(
      event.id,
      [
        {
          localId: "local-forged-1",
          qrCodeValue: forgedPayload,
          scannedAt: new Date().toISOString(),
        },
      ],
      staff,
    );
    expect(result.succeeded).toBe(0);
    expect(result.results[0].status).toBe("invalid_qr");
  });

  it("HKDF key derivation is stable across signer / verifier (determinism check)", async () => {
    // Same (master, eventId, kid) must produce the same key twice. A
    // regression here would silently break every v4 badge — this is the
    // smallest possible canary for an HKDF implementation regression.
    const eventId = "evt-determinism";
    const kid = generateEventKid();

    const key1 = deriveEventKey(eventId, kid);
    const key2 = deriveEventKey(eventId, kid);
    expect(key1.equals(key2)).toBe(true);

    // And the HMAC output on the same input must match.
    const payload = "reg1:evt-determinism:user1:abc:def:kid";
    const sig1 = hmacSignWithKey(key1, payload);
    const sig2 = hmacSignWithKey(key2, payload);
    expect(sig1).toBe(sig2);

    // Different kid → different key → different signature.
    const otherKid = generateEventKid();
    const keyOther = deriveEventKey(eventId, otherKid);
    const sigOther = hmacSignWithKey(keyOther, payload);
    expect(sigOther).not.toBe(sig1);
  });
});
