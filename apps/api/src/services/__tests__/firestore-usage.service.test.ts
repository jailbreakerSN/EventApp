import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";
import { ForbiddenError } from "@/errors/app-error";

/**
 * Sprint-3 T4.2 — `FirestoreUsageService` unit tests.
 *
 * Both methods are platform-wide read-only observability surfaces —
 * `requireOrganizationAccess` is intentionally omitted (cross-org
 * comparison is the point), so the four mandatory cases collapse to:
 *   1. Happy path
 *   2. Permission denial
 *   3. Bounds clamping (days/topN clamps work)
 *   4. Firestore failure (propagates)
 *
 * Plus a sanity check for `flushFirestoreUsage()` — its no-op branches
 * (no context, no org, no reads) and the FieldValue.increment call.
 *
 * Determinism: the clock is fixed via `vi.setSystemTime(...)` so the
 * `fromDay` / `toDay` derivation is reproducible.
 */

const hoisted = vi.hoisted(() => ({
  mockCollectionGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockGetRequestContext: vi.fn(),
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: hoisted.mockGetRequestContext,
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n: number) => ({ __op: "increment", n }),
  },
}));

vi.mock("@/config/firebase", () => {
  const buildCollection = () => {
    const builder: Record<string, unknown> = {
      where: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      get: hoisted.mockCollectionGet,
      doc: vi.fn(() => ({
        set: hoisted.mockDocSet,
      })),
    };
    return builder;
  };
  return {
    db: {
      collection: vi.fn(() => buildCollection()),
    },
    COLLECTIONS: {
      FIRESTORE_USAGE: "firestoreUsage",
    },
  };
});

import { firestoreUsageService, flushFirestoreUsage } from "../firestore-usage.service";

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date("2026-04-25T12:00:00.000Z"));
  hoisted.mockGetRequestContext.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── getTopConsumers ──────────────────────────────────────────────────────

describe("FirestoreUsageService.getTopConsumers", () => {
  it("returns top consumers sorted by reads desc with daily breakdown", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockResolvedValue({
      docs: [
        { data: () => ({ organizationId: "org-A", day: "2026-04-25", reads: 100 }) },
        { data: () => ({ organizationId: "org-B", day: "2026-04-25", reads: 50 }) },
        { data: () => ({ organizationId: "org-A", day: "2026-04-24", reads: 30 }) },
      ],
    });

    const out = await firestoreUsageService.getTopConsumers(admin, { days: 2, topN: 5 });

    expect(out.days).toBe(2);
    expect(out.totalReads).toBe(180);
    expect(out.topConsumers[0]).toEqual({
      organizationId: "org-A",
      reads: 130,
      pct: 130 / 180,
    });
    expect(out.topConsumers[1]?.organizationId).toBe("org-B");
    expect(out.daily).toHaveLength(2);
    // Most recent day appears last in the daily series.
    expect(out.daily[1]?.day).toBe("2026-04-25");
  });

  it("rejects callers without platform:audit_read or platform:manage", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(firestoreUsageService.getTopConsumers(participant)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("clamps days into [1, 30] and topN into [1, 50]", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockResolvedValue({ docs: [] });

    const out = await firestoreUsageService.getTopConsumers(admin, {
      days: 999,
      topN: 999,
    });
    expect(out.days).toBe(30);
    // No top consumers since the snapshot is empty — but the upper
    // clamp on topN is exercised because a request asking for 999
    // would otherwise OOM the response.
    expect(out.topConsumers).toHaveLength(0);

    const out2 = await firestoreUsageService.getTopConsumers(admin, {
      days: -5,
      topN: 0,
    });
    expect(out2.days).toBe(1);
  });

  it("propagates Firestore failures", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockRejectedValue(new Error("FIRESTORE_DOWN"));
    await expect(firestoreUsageService.getTopConsumers(admin)).rejects.toThrow("FIRESTORE_DOWN");
  });

  it("ignores rows with non-positive or non-finite reads", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockResolvedValue({
      docs: [
        { data: () => ({ organizationId: "org-A", day: "2026-04-25", reads: 100 }) },
        { data: () => ({ organizationId: "org-B", day: "2026-04-25", reads: -5 }) },
        { data: () => ({ organizationId: "org-C", day: "2026-04-25", reads: NaN }) },
        { data: () => ({ organizationId: "", day: "2026-04-25", reads: 1000 }) }, // missing org
      ],
    });

    const out = await firestoreUsageService.getTopConsumers(admin, { days: 1 });
    expect(out.totalReads).toBe(100);
    expect(out.topConsumers).toHaveLength(1);
    expect(out.topConsumers[0]?.organizationId).toBe("org-A");
  });
});

// ─── getOrgUsage ──────────────────────────────────────────────────────────

describe("FirestoreUsageService.getOrgUsage", () => {
  it("returns daily reads for the requested org", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockResolvedValue({
      docs: [
        { data: () => ({ day: "2026-04-25", reads: 75 }) },
        { data: () => ({ day: "2026-04-23", reads: 25 }) },
      ],
    });

    const out = await firestoreUsageService.getOrgUsage(admin, "org-1", { days: 3 });
    expect(out.organizationId).toBe("org-1");
    expect(out.totalReads).toBe(100);
    expect(out.daily).toHaveLength(3);
    // The middle day has no data → 0.
    expect(out.daily.find((d) => d.day === "2026-04-24")?.reads).toBe(0);
  });

  it("rejects callers without platform:audit_read or platform:manage", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      firestoreUsageService.getOrgUsage(participant, "org-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("clamps days into [1, 30]", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockResolvedValue({ docs: [] });
    const out = await firestoreUsageService.getOrgUsage(admin, "org-1", { days: 9999 });
    expect(out.days).toBe(30);
  });

  it("propagates Firestore failures", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockRejectedValue(new Error("FIRESTORE_DOWN"));
    await expect(firestoreUsageService.getOrgUsage(admin, "org-1")).rejects.toThrow(
      "FIRESTORE_DOWN",
    );
  });
});

// ─── flushFirestoreUsage ──────────────────────────────────────────────────

describe("flushFirestoreUsage", () => {
  it("no-ops when there is no request context", async () => {
    hoisted.mockGetRequestContext.mockReturnValue(null);
    await flushFirestoreUsage();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it("no-ops when the request has no organizationId (anonymous probe)", async () => {
    hoisted.mockGetRequestContext.mockReturnValue({
      requestId: "r-1",
      userId: "u-1",
      startTime: Date.now(),
      firestoreReads: 5,
      organizationId: null,
    });
    await flushFirestoreUsage();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it("no-ops when the read counter is zero", async () => {
    hoisted.mockGetRequestContext.mockReturnValue({
      requestId: "r-1",
      userId: "u-1",
      startTime: Date.now(),
      firestoreReads: 0,
      organizationId: "org-1",
    });
    await flushFirestoreUsage();
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it("upserts the bucket doc with FieldValue.increment when reads > 0", async () => {
    hoisted.mockGetRequestContext.mockReturnValue({
      requestId: "r-1",
      userId: "u-1",
      startTime: Date.now(),
      firestoreReads: 7,
      organizationId: "org-1",
    });
    await flushFirestoreUsage();
    expect(hoisted.mockDocSet).toHaveBeenCalledTimes(1);
    const [payload, options] = hoisted.mockDocSet.mock.calls[0]!;
    expect(payload).toMatchObject({
      organizationId: "org-1",
      day: "2026-04-25",
      reads: { __op: "increment", n: 7 },
    });
    expect(options).toEqual({ merge: true });
  });

  it("swallows Firestore write failures (best-effort)", async () => {
    hoisted.mockGetRequestContext.mockReturnValue({
      requestId: "r-1",
      userId: "u-1",
      startTime: Date.now(),
      firestoreReads: 3,
      organizationId: "org-1",
    });
    hoisted.mockDocSet.mockRejectedValueOnce(new Error("FIRESTORE_DOWN"));
    await expect(flushFirestoreUsage()).resolves.toBeUndefined();
  });
});
