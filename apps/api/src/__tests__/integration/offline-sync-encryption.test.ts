import { describe, it, expect, beforeEach } from "vitest";
import { checkinService } from "@/services/checkin.service";
import {
  sealOfflineSyncPayload,
  __openOfflineSyncPayloadForTest,
  __generateClientKeyPairForTest,
} from "@/services/offline-sync-crypto";
import { buildStaffUser } from "@/__tests__/factories";
import {
  clearFirestore,
  seedSystemPlans,
  createOrgOnPlan,
  createEvent,
  createRegistration,
} from "./helpers";

/**
 * Integration coverage for the Sprint A 4.2 encrypted offline-sync
 * envelope. The contract:
 *
 *   1. Staff app generates an ephemeral X25519 keypair at sync time.
 *   2. Server generates its own ephemeral X25519 keypair, runs ECDH
 *      with the client's pub, derives AES-256-GCM key via HKDF-SHA256
 *      (info = `teranga/offline-sync/v1`).
 *   3. Server seals the full offline-sync payload with that key; AAD
 *      is the eventId (so a ciphertext leaked from event A can't
 *      replay as event B's payload — GCM will tag-fail on open).
 *   4. Server ships the envelope. Client derives the same key via
 *      ECDH(client_priv, server_pub), opens, decrypts.
 *
 * This test runs the whole loop: real `checkinService.getOfflineSyncData`
 * against the Firestore emulator → real `sealOfflineSyncPayload` → the
 * reference decrypt in `__openOfflineSyncPayloadForTest`. If the server
 * half ever diverges from the Flutter client's expected derivation,
 * this test fails loud before CI green-lights the PR.
 *
 * The test-only reference decrypt (`__openOfflineSyncPayloadForTest`)
 * is a faithful mirror of what the Flutter scanner will run — shared
 * HKDF info string, matching AAD, same nonce + tag parsing. Treat it
 * as the contract the mobile client must satisfy.
 */
describe("Integration: encrypted offline-sync envelope (Sprint A 4.2)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("seals and opens with matching payload (full round-trip)", async () => {
    const { id: orgId } = await createOrgOnPlan("starter"); // starter has qrScanning
    const event = await createEvent(orgId);

    // Seed a handful of registrations so the payload has meaningful content
    // to diff before vs. after the envelope round-trip. Offline sync ships
    // every confirmed participant's QR.
    await createRegistration(event.id, "user-alice");
    await createRegistration(event.id, "user-bob");
    await createRegistration(event.id, "user-cleo");

    const staff = buildStaffUser({ organizationId: orgId });

    // ── Server half ─────────────────────────────────────────────────────
    const data = await checkinService.getOfflineSyncData(event.id, staff);
    expect(data.totalRegistrations).toBe(3);

    // ── Client generates ephemeral keypair (mirrors Flutter) ────────────
    const clientPair = __generateClientKeyPairForTest();

    // ── Server seals with eventId as AAD ────────────────────────────────
    const envelope = sealOfflineSyncPayload(data, clientPair.publicKeyRaw, event.id);
    expect(envelope.protocol).toBe("ecdh-x25519-aes256gcm-v1");
    expect(envelope.serverPublicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.tag).toMatch(/^[A-Za-z0-9_-]+$/);

    // ── Client half: derive shared key + decrypt ────────────────────────
    const recovered = __openOfflineSyncPayloadForTest(envelope, clientPair.privateKey, event.id);

    // Payload shape survives the round-trip unchanged — critical for the
    // Flutter scanner's offline cache to key by the same fields.
    expect(recovered).toEqual(data);
  });

  it("rejects a ciphertext resealed against a different eventId (AAD guard)", async () => {
    // A ciphertext leaked from event A must NOT decrypt as event B's
    // payload. This is the whole reason eventId is the AAD — GCM tag
    // verification fails on mismatch and the decrypt throws.
    const { id: orgId } = await createOrgOnPlan("starter");
    const eventA = await createEvent(orgId);
    await createRegistration(eventA.id, "user-a");
    const staff = buildStaffUser({ organizationId: orgId });

    const data = await checkinService.getOfflineSyncData(eventA.id, staff);
    const clientPair = __generateClientKeyPairForTest();

    // Server seals against event A's AAD.
    const envelope = sealOfflineSyncPayload(data, clientPair.publicKeyRaw, eventA.id);

    // Attempting to open with event B's AAD must throw (auth-tag fail).
    expect(() =>
      __openOfflineSyncPayloadForTest(envelope, clientPair.privateKey, "event-B-different"),
    ).toThrow();
  });

  it("rejects a ciphertext resealed against a different client key (ECDH guard)", async () => {
    // Forward secrecy: a ciphertext sealed for client A's pub key must
    // not open with client B's priv key. Proves the ECDH side of the
    // handshake isn't bypassable by swapping the priv half.
    const { id: orgId } = await createOrgOnPlan("starter");
    const event = await createEvent(orgId);
    await createRegistration(event.id, "user-a");
    const staff = buildStaffUser({ organizationId: orgId });

    const data = await checkinService.getOfflineSyncData(event.id, staff);
    const clientA = __generateClientKeyPairForTest();
    const clientB = __generateClientKeyPairForTest();

    const envelope = sealOfflineSyncPayload(data, clientA.publicKeyRaw, event.id);

    expect(() => __openOfflineSyncPayloadForTest(envelope, clientB.privateKey, event.id)).toThrow();
  });
});
