import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/errors/app-error";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// Phase 7+ B2 closure tests cover the admin observability surfaces
// added on top of the recurring-events / waitlist closure: the
// `waitlist.stuck` inbox signal and the per-event `waitlist health`
// snapshot endpoint. Both run against arbitrarily-chained Firestore
// `where(...).where(...).count().get()` queries, so we model the chain
// with a small fluent mock that lets each test queue its own response
// sequence.

interface QueryStub {
  count: () => { get: () => Promise<{ data: () => { count: number } }> };
  select: (..._fields: string[]) => QueryStub;
  orderBy: (..._args: unknown[]) => QueryStub;
  limit: (_n: number) => QueryStub;
  offset: (_n: number) => QueryStub;
  get: () => Promise<{
    docs: Array<{ id: string; data: () => Record<string, unknown> }>;
    empty: boolean;
    size: number;
  }>;
  where: (..._args: unknown[]) => QueryStub;
}

const queueGet: Array<() => Promise<unknown>> = [];
const queueCount: Array<number> = [];

function buildQueryStub(): QueryStub {
  const stub: QueryStub = {
    where: () => stub,
    select: () => stub,
    orderBy: () => stub,
    limit: () => stub,
    offset: () => stub,
    count: () => ({
      get: async () => {
        const next = queueCount.shift() ?? 0;
        return { data: () => ({ count: next }) };
      },
    }),
    get: async () => {
      const next = queueGet.shift();
      if (next) {
        return next() as Promise<{
          docs: Array<{ id: string; data: () => Record<string, unknown> }>;
          empty: boolean;
          size: number;
        }>;
      }
      return { docs: [], empty: true, size: 0 };
    },
  };
  return stub;
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => buildQueryStub()),
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
  },
  auth: {},
  COLLECTIONS: {
    USERS: "users",
    ORGANIZATIONS: "organizations",
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    PAYMENTS: "payments",
    VENUES: "venues",
    AUDIT_LOGS: "auditLogs",
    SUBSCRIPTIONS: "subscriptions",
    INVITES: "invites",
    FEATURE_FLAGS: "featureFlags",
    IMPERSONATION_CODES: "impersonationCodes",
    WEBHOOK_EVENTS: "webhookEvents",
    CHECKINS: "checkins",
  },
}));

vi.mock("@/repositories/admin.repository", () => ({
  adminRepository: {
    listAllEvents: vi.fn(),
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

import { adminService } from "../admin.service";

beforeEach(() => {
  vi.clearAllMocks();
  queueCount.length = 0;
  queueGet.length = 0;
});

// ─── waitlist.stuck inbox signal ─────────────────────────────────────────

describe("AdminService.getInboxSignals — waitlist.stuck signal (Phase 7+ B2)", () => {
  // The inbox runs 11 parallel `safeCount` probes. 7 of them resolve
  // through `count().get()` (queueCount), 4 of them resolve through a
  // direct `select(...).limit(...).get()` chain (queueGet, in order):
  //   1. venues.pending        → count
  //   2. orgs.unverified       → count
  //   3. payments.pending_24h  → count
  //   4. subscriptions.past_due → count
  //   5. payments.failed       → count
  //   6. invites.expired       → count
  //   7. webhooks.failed_24h   → count
  //   8. anomaly.signups_by_ip   → get
  //   9. anomaly.multi_device_scans → get
  //  10. events_live            → get
  //  11. waitlist.stuck         → get
  // So fixtures need to queue 7 zeros + 4 doc payloads.

  const emptyDocs = async () => ({ docs: [], empty: true, size: 0 });

  it("emits a `waitlist.stuck` signal when audit rows mention distinct events", async () => {
    const admin = buildSuperAdmin();

    for (let i = 0; i < 7; i += 1) queueCount.push(0);
    queueGet.push(emptyDocs); // signups_by_ip
    queueGet.push(emptyDocs); // multi_device_scans
    queueGet.push(emptyDocs); // events_live
    queueGet.push(async () => ({
      // waitlist.stuck — three rows, two distinct events.
      docs: [
        { id: "audit-1", data: () => ({ resourceId: "evt-A" }) },
        { id: "audit-2", data: () => ({ resourceId: "evt-A" }) },
        { id: "audit-3", data: () => ({ resourceId: "evt-B" }) },
      ],
      empty: false,
      size: 3,
    }));

    const result = await adminService.getInboxSignals(admin);
    const signal = result.signals.find((s) => s.id === "waitlist.stuck");
    expect(signal).toBeDefined();
    expect(signal?.count).toBe(2);
    expect(signal?.severity).toBe("warning");
    expect(signal?.category).toBe("ops");
    expect(signal?.href).toContain("waitlist.promotion_failed");
  });

  it("does NOT emit the signal when no failures landed in the last 24h", async () => {
    const admin = buildSuperAdmin();

    for (let i = 0; i < 7; i += 1) queueCount.push(0);
    queueGet.push(emptyDocs);
    queueGet.push(emptyDocs);
    queueGet.push(emptyDocs);
    queueGet.push(emptyDocs);

    const result = await adminService.getInboxSignals(admin);
    expect(result.signals.find((s) => s.id === "waitlist.stuck")).toBeUndefined();
  });
});

// ─── getWaitlistHealth (per-event snapshot) ──────────────────────────────

describe("AdminService.getWaitlistHealth", () => {
  it("returns the four counts + last-promoted timestamp for super_admin", async () => {
    const admin = buildSuperAdmin();

    // Four queries fire in parallel: waitlistedCount, promotedCount30d,
    // failureCount30d (count-only), and the lastPromoted snapshot
    // (get-only). Order matches the implementation's Promise.all.
    queueCount.push(7); // waitlistedCount
    queueCount.push(3); // promotedCount30d
    queueCount.push(1); // failureCount30d
    queueGet.push(async () => ({
      docs: [
        { id: "audit-x", data: () => ({ timestamp: "2026-04-25T10:00:00.000Z" }) },
      ],
      empty: false,
      size: 1,
    }));

    const result = await adminService.getWaitlistHealth(admin, "evt-1");
    expect(result).toEqual({
      eventId: "evt-1",
      waitlistedCount: 7,
      promotedCount30d: 3,
      failureCount30d: 1,
      lastPromotedAt: "2026-04-25T10:00:00.000Z",
    });
  });

  it("returns lastPromotedAt: null when no promotion has ever fired", async () => {
    const admin = buildSuperAdmin();

    queueCount.push(2); // waitlistedCount
    queueCount.push(0); // promotedCount30d
    queueCount.push(0); // failureCount30d
    queueGet.push(async () => ({ docs: [], empty: true, size: 0 }));

    const result = await adminService.getWaitlistHealth(admin, "evt-2");
    expect(result.lastPromotedAt).toBeNull();
    expect(result.waitlistedCount).toBe(2);
  });

  it("rejects non-super_admin callers with ForbiddenError", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(adminService.getWaitlistHealth(participant, "evt-1")).rejects.toThrow(
      ForbiddenError,
    );
  });
});
