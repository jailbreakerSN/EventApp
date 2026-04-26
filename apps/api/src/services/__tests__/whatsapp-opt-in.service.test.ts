import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, NotFoundError } from "@/errors/app-error";
import { buildAuthUser } from "@/__tests__/factories";
import type { WhatsappOptIn } from "@teranga/shared-types";

// ─── WhatsApp opt-in service — consent contract ───────────────────────────
//
// Phase O6: every grant / revoke must hit Firestore + emit a domain
// event for the audit log. Tests pin: id derivation, idempotency on
// re-grant with same phone, re-grant after revoke (reGrant flag),
// 404 on revoke without prior opt-in, and event emission.

interface DocStub {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

// vi.mock factories are hoisted to the top of the file — top-level
// variables they reference don't exist yet. Use vi.hoisted() to declare
// the shared spies in a way the hoisted mocks can see.
const hoisted = vi.hoisted(() => ({
  storedDoc: null as DocStub | null,
  setMock: vi.fn(),
  getMock: vi.fn(),
  emitMock: vi.fn(),
}));
const setMock = hoisted.setMock;
const emitMock = hoisted.emitMock;
function setStoredDoc(value: DocStub | null): void {
  hoisted.storedDoc = value;
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: async () => hoisted.storedDoc ?? { exists: false, data: () => undefined },
        set: hoisted.setMock,
      })),
    })),
    // grant() / revoke() now run inside db.runTransaction so the
    // read-then-write is atomic. The mock plays the callback against
    // a tx whose `get` returns the stored doc and whose `set`
    // records via `setMock` — same pattern as `incident.service.test`.
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: async () => hoisted.storedDoc ?? { exists: false, data: () => undefined },
        set: (_ref: unknown, value: unknown) => {
          hoisted.setMock(value);
        },
      };
      return cb(tx);
    }),
  },
  COLLECTIONS: {
    WHATSAPP_OPT_INS: "whatsappOptIns",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: {
    emit: hoisted.emitMock,
  },
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: () => ({ requestId: "test-request-id" }),
  getRequestId: () => "test-request-id",
  trackFirestoreReads: vi.fn(),
}));

import { whatsappOptInService } from "../whatsapp-opt-in.service";

beforeEach(() => {
  vi.clearAllMocks();
  setStoredDoc(null);
});

describe("whatsappOptInService.grant — happy path + idempotency", () => {
  it("creates a fresh opt-in record on first grant and emits whatsapp.opt_in.granted", async () => {
    const user = buildAuthUser({ uid: "u-1", organizationId: "org-1" });

    const result = await whatsappOptInService.grant(user, {
      organizationId: "org-1",
      phoneE164: "+221700000000",
    });

    expect(result.id).toBe("u-1_org-1");
    expect(result.userId).toBe("u-1");
    expect(result.status).toBe("opted_in");
    expect(result.phoneE164).toBe("+221700000000");
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      "whatsapp.opt_in.granted",
      expect.objectContaining({
        userId: "u-1",
        organizationId: "org-1",
        reGrant: false,
      }),
    );
    // Privacy: phone number MUST NOT be in the audit-bound payload —
    // it lives on the persisted `whatsappOptIns/{id}` doc only.
    const grantCall = emitMock.mock.calls.find(
      (c: unknown[]) => c[0] === "whatsapp.opt_in.granted",
    );
    expect(grantCall![1]).not.toHaveProperty("phoneE164");
  });

  it("is idempotent when re-granted with the SAME phone — no Firestore write, no event", async () => {
    const user = buildAuthUser({ uid: "u-1" });
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "u-1_org-1",
          userId: "u-1",
          organizationId: "org-1",
          phoneE164: "+221700000000",
          status: "opted_in",
          acceptedAt: "2026-04-01T00:00:00.000Z",
          revokedAt: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }) as WhatsappOptIn,
    });

    const result = await whatsappOptInService.grant(user, {
      organizationId: "org-1",
      phoneE164: "+221700000000",
    });

    expect(result.acceptedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(setMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("flags reGrant=true when re-granting after a revoke", async () => {
    const user = buildAuthUser({ uid: "u-1" });
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "u-1_org-1",
          userId: "u-1",
          organizationId: "org-1",
          phoneE164: "+221700000000",
          status: "revoked",
          acceptedAt: "2026-03-01T00:00:00.000Z",
          revokedAt: "2026-04-15T00:00:00.000Z",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        }) as WhatsappOptIn,
    });

    await whatsappOptInService.grant(user, {
      organizationId: "org-1",
      phoneE164: "+221700000000",
    });

    expect(emitMock).toHaveBeenCalledWith(
      "whatsapp.opt_in.granted",
      expect.objectContaining({ reGrant: true }),
    );
  });

  it("rejects callers without a uid (defensive — should be caught upstream by authenticate)", async () => {
    const user = buildAuthUser({ uid: "" });
    await expect(
      whatsappOptInService.grant(user, {
        organizationId: "org-1",
        phoneE164: "+221700000000",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("whatsappOptInService.revoke", () => {
  it("flips status to revoked, sets revokedAt, emits whatsapp.opt_in.revoked", async () => {
    const user = buildAuthUser({ uid: "u-1" });
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "u-1_org-1",
          userId: "u-1",
          organizationId: "org-1",
          phoneE164: "+221700000000",
          status: "opted_in",
          acceptedAt: "2026-04-01T00:00:00.000Z",
          revokedAt: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }) as WhatsappOptIn,
    });

    const result = await whatsappOptInService.revoke(user, "org-1");

    expect(result.status).toBe("revoked");
    expect(result.revokedAt).not.toBeNull();
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      "whatsapp.opt_in.revoked",
      expect.objectContaining({ userId: "u-1", organizationId: "org-1" }),
    );
  });

  it("404s when no opt-in record exists for the (user, org) pair", async () => {
    const user = buildAuthUser({ uid: "u-1" });
    setStoredDoc(null);
    await expect(whatsappOptInService.revoke(user, "org-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is idempotent on a doc already in `revoked` state — no event re-emit", async () => {
    const user = buildAuthUser({ uid: "u-1" });
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "u-1_org-1",
          userId: "u-1",
          organizationId: "org-1",
          phoneE164: "+221700000000",
          status: "revoked",
          acceptedAt: "2026-04-01T00:00:00.000Z",
          revokedAt: "2026-04-15T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        }) as WhatsappOptIn,
    });

    const result = await whatsappOptInService.revoke(user, "org-1");
    expect(result.status).toBe("revoked");
    expect(setMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("whatsappOptInService.hasActiveOptIn — gate for outbound sends", () => {
  it("returns true for an opted-in record", async () => {
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          status: "opted_in",
        }) as WhatsappOptIn,
    });
    expect(await whatsappOptInService.hasActiveOptIn("u-1", "org-1")).toBe(true);
  });

  it("returns false for a revoked record", async () => {
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          status: "revoked",
        }) as WhatsappOptIn,
    });
    expect(await whatsappOptInService.hasActiveOptIn("u-1", "org-1")).toBe(false);
  });

  it("returns false when no record exists", async () => {
    setStoredDoc(null);
    expect(await whatsappOptInService.hasActiveOptIn("u-1", "org-1")).toBe(false);
  });
});
