import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// T1.3 widened `exportCsv` with 4 new resources (venues / plans /
// subscriptions / notifications). This file focuses on their streaming
// paths. The mocks are scoped to the data sources each branch uses:
//   - venues → venueRepository.findAll
//   - plans → planRepository.listCatalog
//   - subscriptions → direct db.collection(SUBSCRIPTIONS) cursor scan
//   - notifications → direct db.collection(NOTIFICATION_DISPATCH_LOG)
//     windowed scan

// `vi.mock` factories are hoisted above imports, so any symbols they
// reference must also be hoisted. `vi.hoisted` is the official escape hatch.
const hoisted = vi.hoisted(() => {
  type FakeSnap = {
    empty: boolean;
    docs: Array<{ id: string; data: () => Record<string, unknown> }>;
  };
  const mockVenueFindAll = vi.fn();
  const mockPlanListCatalog = vi.fn();
  const mockSubsSnap: { value: FakeSnap } = { value: { empty: true, docs: [] } };
  const mockNotifSnap: { value: FakeSnap } = { value: { empty: true, docs: [] } };
  return { mockVenueFindAll, mockPlanListCatalog, mockSubsSnap, mockNotifSnap };
});
const { mockVenueFindAll, mockPlanListCatalog, mockSubsSnap, mockNotifSnap } = hoisted;

vi.mock("@/repositories/venue.repository", () => ({
  venueRepository: { findAll: hoisted.mockVenueFindAll },
}));

vi.mock("@/repositories/plan.repository", () => ({
  planRepository: { listCatalog: hoisted.mockPlanListCatalog },
}));

vi.mock("@/config/firebase", () => {
  // Chainable Firestore query builder for subscriptions + notifications.
  // Each `where/orderBy/limit/startAfter` returns the same object so
  // callers can chain freely; terminal `get()` returns the preloaded snap.
  const fakeQuery = (snap: { value: { empty: boolean; docs: unknown[] } }) => {
    const q: Record<string, unknown> = {
      where: vi.fn(() => q),
      orderBy: vi.fn(() => q),
      limit: vi.fn(() => q),
      startAfter: vi.fn(() => q),
      get: vi.fn(async () => snap.value),
    };
    return q;
  };
  return {
    db: {
      collection: vi.fn((name: string) => {
        if (name === "subscriptions") return fakeQuery(hoisted.mockSubsSnap);
        if (name === "notificationDispatchLog") return fakeQuery(hoisted.mockNotifSnap);
        return {
          doc: vi.fn(() => ({ get: vi.fn(), set: vi.fn() })),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn(async () => ({ empty: true, docs: [] })),
        };
      }),
    },
    auth: {},
    COLLECTIONS: {
      USERS: "users",
      ORGANIZATIONS: "organizations",
      EVENTS: "events",
      VENUES: "venues",
      AUDIT_LOGS: "auditLogs",
      SUBSCRIPTIONS: "subscriptions",
      PLANS: "plans",
      NOTIFICATION_DISPATCH_LOG: "notificationDispatchLog",
    },
  };
});

vi.mock("@/repositories/admin.repository", () => ({
  adminRepository: {
    listAllUsers: vi.fn(),
    listAllOrganizations: vi.fn(),
    listAllEvents: vi.fn(),
    listAuditLogs: vi.fn(),
  },
}));

vi.mock("@/events/event-bus", () => ({ eventBus: { emit: vi.fn() } }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "test-req" }));

// Import AFTER mocks
import { adminService } from "../admin.service";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubsSnap.value = { empty: true, docs: [] };
  mockNotifSnap.value = { empty: true, docs: [] };
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("AdminService.exportCsv — venues (T1.3)", () => {
  it("emits the venue header + one row per returned venue", async () => {
    mockVenueFindAll.mockResolvedValue({
      data: [
        {
          id: "v-1",
          name: "Dakar Conf Center",
          slug: "dakar-conf-center",
          venueType: "conference_center",
          status: "approved",
          address: { city: "Dakar", country: "SN" },
          hostOrganizationId: "org-001",
          contactEmail: "contact@dcc.sn",
          contactPhone: null,
          isFeatured: true,
          rating: 4.5,
          eventCount: 12,
          createdAt: "2026-01-15T10:00:00.000Z",
        },
      ],
      meta: { page: 1, limit: 500, total: 1, totalPages: 1 },
    });

    const admin = buildSuperAdmin();
    const stream = adminService.exportCsv(admin, "venues", {});
    const out = await readStreamToString(stream);

    expect(out).toContain(
      "id,name,slug,venueType,status,city,country,hostOrganizationId,contactEmail,contactPhone,isFeatured,rating,eventCount,createdAt\n",
    );
    expect(out).toContain("v-1,Dakar Conf Center");
    expect(out).toContain("Dakar,SN");
  });

  it("forwards the status filter to the repo call", async () => {
    mockVenueFindAll.mockResolvedValue({ data: [], meta: {} });
    const admin = buildSuperAdmin();
    const stream = adminService.exportCsv(admin, "venues", { status: "pending" });
    await readStreamToString(stream);

    expect(mockVenueFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
      expect.objectContaining({ page: 1, limit: 500 }),
    );
  });
});

describe("AdminService.exportCsv — plans (T1.3)", () => {
  it("emits the plan header + one row per catalog entry with nested name fr/en pulled out", async () => {
    mockPlanListCatalog.mockResolvedValue([
      {
        id: "plan-pro-v2",
        key: "pro",
        version: 2,
        isLatest: true,
        lineageId: "lineage-pro",
        name: { fr: "Pro", en: "Pro" },
        priceXof: 29900,
        billingCycle: "monthly",
        sortOrder: 3,
        isPublic: true,
        isArchived: false,
        createdAt: "2026-04-20T09:00:00.000Z",
      },
    ]);

    const admin = buildSuperAdmin();
    const stream = adminService.exportCsv(admin, "plans", {});
    const out = await readStreamToString(stream);

    expect(
      out.startsWith(
        "id,key,version,isLatest,lineageId,nameFr,nameEn,priceXof,billingCycle,sortOrder,isPublic,isArchived,createdAt\n",
      ),
    ).toBe(true);
    expect(out).toContain("plan-pro-v2,pro,2,true,lineage-pro,Pro,Pro,29900,monthly");
  });

  it("propagates the includeArchived / includeHistory flags", async () => {
    mockPlanListCatalog.mockResolvedValue([]);
    const admin = buildSuperAdmin();
    const stream = adminService.exportCsv(admin, "plans", {
      includeArchived: "true",
      includeHistory: "true",
    });
    await readStreamToString(stream);

    expect(mockPlanListCatalog).toHaveBeenCalledWith({
      includeArchived: true,
      includeHistory: true,
      includePrivate: false,
    });
  });
});

describe("AdminService.exportCsv — subscriptions (T1.3)", () => {
  it("emits the subscription header + a row per returned doc", async () => {
    mockSubsSnap.value = {
      empty: false,
      docs: [
        {
          id: "sub-1",
          data: () => ({
            organizationId: "org-001",
            plan: "pro",
            status: "past_due",
            billingCycle: "monthly",
            priceXof: 29900,
            startDate: "2026-03-01T00:00:00.000Z",
            endDate: "2026-05-01T00:00:00.000Z",
            trialEndsAt: null,
            createdAt: "2026-02-28T09:00:00.000Z",
          }),
        },
      ],
    };

    const admin = buildSuperAdmin();
    const stream = adminService.exportCsv(admin, "subscriptions", {});
    const out = await readStreamToString(stream);

    expect(out).toContain(
      "id,organizationId,plan,status,billingCycle,priceXof,startDate,endDate,trialEndsAt,createdAt\n",
    );
    expect(out).toContain("sub-1,org-001,pro,past_due,monthly,29900");
  });
});

describe("AdminService.exportCsv — notifications (T1.3)", () => {
  it("emits the dispatch-log header + a row per returned entry", async () => {
    mockNotifSnap.value = {
      empty: false,
      docs: [
        {
          id: "n-1",
          data: () => ({
            attemptedAt: "2026-04-20T12:34:56.000Z",
            notificationKey: "registration.confirmed",
            channel: "email",
            recipientRef: "user:alice-1",
            result: "sent",
            suppressionReason: null,
            providerMessageId: "resend_abc",
          }),
        },
      ],
    };

    const admin = buildSuperAdmin();
    const stream = adminService.exportCsv(admin, "notifications", {});
    const out = await readStreamToString(stream);

    expect(out).toContain(
      "attemptedAt,notificationKey,channel,recipientRef,result,suppressionReason,providerMessageId\n",
    );
    expect(out).toContain(
      "2026-04-20T12:34:56.000Z,registration.confirmed,email,user:alice-1,sent",
    );
  });
});

describe("AdminService.exportCsv — permission enforcement", () => {
  it("rejects callers without platform:manage before touching any data source", async () => {
    const { buildAuthUser } = await import("@/__tests__/factories");
    const participant = buildAuthUser({ roles: ["participant"] });

    expect(() => adminService.exportCsv(participant, "venues", {})).toThrow(/platform:manage/i);
    expect(mockVenueFindAll).not.toHaveBeenCalled();
    expect(mockPlanListCatalog).not.toHaveBeenCalled();
  });
});
