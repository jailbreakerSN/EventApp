import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * T2.6 — admin.repository.listAuditLogs search path.
 *
 * We mock the Firestore query builder at a level that lets us
 * exercise the server-side query composition + the in-memory
 * substring filter + pagination. The "no search" path still flows
 * through the shared paginatedQuery helper (covered by existing
 * route-level tests).
 */

const hoisted = vi.hoisted(() => ({
  // Every test sets `docs` to the pre-scan snapshot; the `where()`
  // chain records the filters applied so tests can assert them.
  docs: [] as Array<{ id: string; data: () => unknown }>,
  appliedWhere: [] as Array<{ field: string; op: string; value: unknown }>,
  appliedOrderBy: null as { field: string; dir: string } | null,
  appliedLimit: 0,
}));

function makeChain() {
  const chain = {
    where: (field: string, op: string, value: unknown) => {
      hoisted.appliedWhere.push({ field, op, value });
      return chain;
    },
    orderBy: (field: string, dir: string) => {
      hoisted.appliedOrderBy = { field, dir };
      return chain;
    },
    limit: (n: number) => {
      hoisted.appliedLimit = n;
      return chain;
    },
    offset: () => chain,
    count: () => ({
      get: async () => ({ data: () => ({ count: hoisted.docs.length }) }),
    }),
    get: async () => ({ docs: hoisted.docs }),
  };
  return chain;
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => makeChain()),
  },
  COLLECTIONS: { AUDIT_LOGS: "auditLogs" },
}));

import { adminRepository } from "../admin.repository";

function doc(
  id: string,
  data: Record<string, unknown>,
): { id: string; data: () => Record<string, unknown> } {
  return { id, data: () => data };
}

beforeEach(() => {
  hoisted.docs = [];
  hoisted.appliedWhere = [];
  hoisted.appliedOrderBy = null;
  hoisted.appliedLimit = 0;
});

// ─── Fast path (no search) ─────────────────────────────────────────────────

describe("adminRepository.listAuditLogs — no search", () => {
  it("passes structured filters to Firestore and returns the page", async () => {
    hoisted.docs = [
      doc("a1", { action: "event.created", timestamp: "2026-04-20T00:00:00Z" }),
      doc("a2", { action: "event.updated", timestamp: "2026-04-19T00:00:00Z" }),
    ];
    const result = await adminRepository.listAuditLogs(
      { action: "event.created" },
      { page: 1, limit: 20 },
    );
    expect(result.data).toHaveLength(2);
    const whereActions = hoisted.appliedWhere.filter((w) => w.field === "action");
    expect(whereActions).toContainEqual({ field: "action", op: "==", value: "event.created" });
  });
});

// ─── Search path (T2.6) ────────────────────────────────────────────────────

describe("adminRepository.listAuditLogs — search", () => {
  it("filters in-memory by matching against structured fields + details JSON", async () => {
    hoisted.docs = [
      doc("a1", {
        action: "api_key.created",
        actorId: "admin-1",
        resourceType: "api_key",
        resourceId: "abc123",
        organizationId: "org-1",
        timestamp: "2026-04-20T00:00:00Z",
        details: { name: "Scanner iPad #3", scopes: ["checkin:scan"] },
      }),
      doc("a2", {
        action: "event.created",
        actorId: "admin-2",
        timestamp: "2026-04-19T00:00:00Z",
        details: { title: "Gala de la tech" },
      }),
    ];

    const hit = await adminRepository.listAuditLogs(
      { search: "scanner ipad" },
      { page: 1, limit: 20 },
    );
    expect(hit.data).toHaveLength(1);
    expect(hit.data[0]?.id).toBe("a1");

    // Reset for second query
    hoisted.docs = [
      doc("a1", {
        action: "api_key.created",
        details: { name: "Scanner iPad #3" },
        timestamp: "2026-04-20T00:00:00Z",
      }),
      doc("a2", {
        action: "event.created",
        details: { title: "Gala de la tech" },
        timestamp: "2026-04-19T00:00:00Z",
      }),
    ];
    const byAction = await adminRepository.listAuditLogs(
      { search: "api_key" },
      { page: 1, limit: 20 },
    );
    expect(byAction.data).toHaveLength(1);
    expect(byAction.data[0]?.id).toBe("a1");
  });

  it("is case-insensitive on the search term", async () => {
    hoisted.docs = [
      doc("a1", {
        action: "api_key.created",
        details: { name: "Scanner iPad #3" },
        timestamp: "2026-04-20T00:00:00Z",
      }),
    ];
    const hit = await adminRepository.listAuditLogs({ search: "SCANNER" }, { page: 1, limit: 20 });
    expect(hit.data).toHaveLength(1);
  });

  it("respects the 500-row hard scan cap", async () => {
    // We can't directly observe the limit, but we can verify it was
    // applied to the underlying chain. 10 × 50 = 500, min(500, 50*10)
    // = 500 — matches the repository's internal cap.
    hoisted.docs = [];
    await adminRepository.listAuditLogs({ search: "anything" }, { page: 1, limit: 50 });
    expect(hoisted.appliedLimit).toBe(500);
  });

  it("applies structured filters (action + actorId) alongside the search", async () => {
    hoisted.docs = [
      doc("a1", {
        action: "api_key.revoked",
        actorId: "admin-1",
        details: { reason: "leaked via github" },
        timestamp: "2026-04-20T00:00:00Z",
      }),
    ];
    const hit = await adminRepository.listAuditLogs(
      { search: "leaked", action: "api_key.revoked", actorId: "admin-1" },
      { page: 1, limit: 20 },
    );
    expect(hit.data).toHaveLength(1);
    // The structured filters must have been applied at the Firestore layer.
    const actions = hoisted.appliedWhere.filter((w) => w.field === "action");
    expect(actions).toContainEqual({ field: "action", op: "==", value: "api_key.revoked" });
    const actors = hoisted.appliedWhere.filter((w) => w.field === "actorId");
    expect(actors).toContainEqual({ field: "actorId", op: "==", value: "admin-1" });
  });

  it("supports resourceId + organizationId filters (new T2.6 params)", async () => {
    hoisted.docs = [];
    await adminRepository.listAuditLogs(
      { search: "x", resourceId: "abc123", organizationId: "org-1" },
      { page: 1, limit: 20 },
    );
    const res = hoisted.appliedWhere.filter((w) => w.field === "resourceId");
    expect(res).toContainEqual({ field: "resourceId", op: "==", value: "abc123" });
    const org = hoisted.appliedWhere.filter((w) => w.field === "organizationId");
    expect(org).toContainEqual({ field: "organizationId", op: "==", value: "org-1" });
  });

  it("returns empty data with total=0 when nothing matches", async () => {
    hoisted.docs = [
      doc("a1", {
        action: "event.created",
        details: { title: "Gala" },
        timestamp: "2026-04-20T00:00:00Z",
      }),
    ];
    const result = await adminRepository.listAuditLogs(
      { search: "no-such-thing-in-any-row" },
      { page: 1, limit: 20 },
    );
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("paginates in-memory over the matched candidates", async () => {
    // 15 matching rows; page 2 limit 10 → 5 rows returned.
    hoisted.docs = Array.from({ length: 15 }, (_, i) =>
      doc(`a${i}`, {
        action: "event.created",
        details: { title: "matching title" },
        timestamp: `2026-04-20T00:00:${String(i).padStart(2, "0")}Z`,
      }),
    );
    const page2 = await adminRepository.listAuditLogs(
      { search: "matching" },
      { page: 2, limit: 10 },
    );
    expect(page2.data).toHaveLength(5);
    expect(page2.meta).toMatchObject({ page: 2, limit: 10, total: 15, totalPages: 2 });
  });
});
