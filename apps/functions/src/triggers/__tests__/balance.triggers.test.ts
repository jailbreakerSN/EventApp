import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Balance release trigger tests ───────────────────────────────────────────
// Pattern mirrors retention.triggers.test.ts: a hand-rolled Firestore fake
// that supports the trigger's specific query shape (where + where + orderBy
// + limit + startAfter + batched commits). Each batch.commit() actually
// mutates the seeded docs so the cursor-paginated loop drains naturally.

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type FakeDoc = {
  id: string;
  data: () => Record<string, unknown>;
  ref: { id: string; _collection: string };
};

interface AuditWrite {
  id: string;
  data: Record<string, unknown>;
}

interface BatchUpdate {
  collection: string;
  id: string;
  patch: Record<string, unknown>;
}

const { collections, batchedUpdates, batchedSets, auditWrites } = vi.hoisted(() => ({
  collections: new Map<string, FakeDoc[]>(),
  batchedUpdates: [] as BatchUpdate[],
  batchedSets: [] as AuditWrite[],
  auditWrites: [] as AuditWrite[],
}));

function makeDoc(collection: string, id: string, data: Record<string, unknown>): FakeDoc {
  return { id, data: () => data, ref: { id, _collection: collection } };
}

vi.mock("../../utils/admin", () => {
  function buildQuery(name: string, state: Record<string, unknown>) {
    return {
      where: (field: string, op: string, value: unknown) =>
        buildQuery(name, {
          ...state,
          where: [...((state.where as unknown[]) ?? []), [field, op, value]],
        }),
      orderBy: (field: string, dir: string = "asc") =>
        buildQuery(name, { ...state, orderBy: field, orderDir: dir }),
      limit: (n: number) => buildQuery(name, { ...state, limit: n }),
      startAfter: (doc: FakeDoc) => buildQuery(name, { ...state, startAfter: doc.id }),
      get: async () => {
        const all = collections.get(name) ?? [];
        let filtered = [...all];
        const whereClauses = (state.where as [string, string, unknown][] | undefined) ?? [];
        for (const [field, op, value] of whereClauses) {
          filtered = filtered.filter((d) => {
            const v = d.data()[field];
            if (op === "==") return v === value;
            if (op === "<=") return typeof v === "string" && v <= (value as string);
            if (op === "<") return typeof v === "string" && v < (value as string);
            return true;
          });
        }
        if (state.orderBy) {
          const field = state.orderBy as string;
          const dir = state.orderDir === "desc" ? -1 : 1;
          filtered.sort((a, b) => {
            const av = a.data()[field] as string;
            const bv = b.data()[field] as string;
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
          });
        }
        if (state.startAfter) {
          const cursorIdx = filtered.findIndex((d) => d.id === state.startAfter);
          if (cursorIdx >= 0) filtered = filtered.slice(cursorIdx + 1);
        }
        const limit = (state.limit as number | undefined) ?? filtered.length;
        const docs = filtered.slice(0, limit);
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
  }

  return {
    db: {
      collection: (name: string) => {
        const q = buildQuery(name, {});
        return {
          ...q,
          // doc() with no arg = autogenerate. Returns a writeable ref.
          doc: (id?: string) => ({
            id: id ?? `${name}-auto-${Math.random().toString(36).slice(2, 10)}`,
            _collection: name,
          }),
        };
      },
      batch: () => {
        const pendingUpdates: BatchUpdate[] = [];
        const pendingSets: AuditWrite[] = [];
        return {
          update: (ref: { id: string; _collection: string }, patch: Record<string, unknown>) => {
            pendingUpdates.push({ collection: ref._collection, id: ref.id, patch });
          },
          set: (ref: { id: string; _collection: string }, data: Record<string, unknown>) => {
            pendingSets.push({ id: ref.id, data });
          },
          commit: async () => {
            for (const u of pendingUpdates) {
              batchedUpdates.push(u);
              const docs = collections.get(u.collection) ?? [];
              const target = docs.find((d) => d.id === u.id);
              if (target) {
                const merged = { ...target.data(), ...u.patch };
                const idx = docs.indexOf(target);
                docs[idx] = makeDoc(u.collection, u.id, merged);
              }
            }
            for (const s of pendingSets) {
              batchedSets.push(s);
              auditWrites.push(s);
              // Also persist into the collections map so later assertions
              // can read it (mirrors Firestore behaviour).
              const docs = collections.get("auditLogs") ?? [];
              docs.push(makeDoc("auditLogs", s.id, s.data));
              collections.set("auditLogs", docs);
            }
          },
        };
      },
    },
    COLLECTIONS: {
      BALANCE_TRANSACTIONS: "balanceTransactions",
      AUDIT_LOGS: "auditLogs",
    },
  };
});

import { releaseAvailableFunds } from "../balance.triggers";

const handler = releaseAvailableFunds as unknown as () => Promise<void>;

function seed(
  collection: string,
  docs: Array<{ id: string; data: Record<string, unknown> }>,
): void {
  collections.set(
    collection,
    docs.map((d) => makeDoc(collection, d.id, d.data)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  collections.clear();
  batchedUpdates.length = 0;
  batchedSets.length = 0;
  auditWrites.length = 0;
});

const NOW = new Date("2026-04-26T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("releaseAvailableFunds", () => {
  // ─── Happy path ────────────────────────────────────────────────────────────

  it("flips pending entries past availableOn to available and writes a per-org audit row", async () => {
    seed("balanceTransactions", [
      {
        id: "bt-due-1",
        data: {
          organizationId: "org-1",
          status: "pending",
          availableOn: iso(-ONE_DAY),
          amount: 17_100,
          kind: "payment",
        },
      },
      {
        id: "bt-due-fee",
        data: {
          organizationId: "org-1",
          status: "pending",
          availableOn: iso(-ONE_DAY),
          amount: -900,
          kind: "platform_fee",
        },
      },
    ]);

    await handler();

    // Both entries flipped to "available".
    expect(batchedUpdates).toHaveLength(2);
    expect(batchedUpdates.every((u) => u.patch.status === "available")).toBe(true);
    expect(batchedUpdates.map((u) => u.id).sort()).toEqual(["bt-due-1", "bt-due-fee"]);

    // The persisted state reflects the update (so a second handler() is a
    // no-op — see the idempotency test below).
    const refreshed = collections.get("balanceTransactions") ?? [];
    expect(refreshed.every((d) => d.data().status === "available")).toBe(true);

    // One audit row per org with aggregated metadata.
    expect(auditWrites).toHaveLength(1);
    const audit = auditWrites[0]!.data;
    expect(audit.action).toBe("balance_transaction.released");
    expect(audit.actorId).toBe("system:balance-release-scheduler");
    expect(audit.organizationId).toBe("org-1");
    expect(audit.resourceType).toBe("organization");
    expect(audit.resourceId).toBe("org-1");
    const details = audit.details as Record<string, unknown>;
    expect(details.count).toBe(2);
    // Net = +17 100 − 900 = +16 200 (the org's net release).
    expect(details.netAmount).toBe(16_200);
    expect(details.sampleEntryIds).toEqual(["bt-due-1", "bt-due-fee"]);
    expect(details.truncated).toBe(false);
  });

  // ─── Filter — only `pending` entries ─────────────────────────────────────

  it("ignores entries that are already `available` or `paid_out` even when availableOn is past", async () => {
    seed("balanceTransactions", [
      {
        id: "bt-already-available",
        data: {
          organizationId: "org-1",
          status: "available",
          availableOn: iso(-ONE_DAY),
          amount: 5_000,
        },
      },
      {
        id: "bt-paid-out",
        data: {
          organizationId: "org-1",
          status: "paid_out",
          availableOn: iso(-2 * ONE_DAY),
          amount: 3_000,
        },
      },
    ]);

    await handler();

    expect(batchedUpdates).toHaveLength(0);
    expect(auditWrites).toHaveLength(0);
  });

  // ─── Filter — only entries past their release window ─────────────────────

  it("leaves pending entries with availableOn in the future untouched", async () => {
    seed("balanceTransactions", [
      {
        id: "bt-future",
        data: {
          organizationId: "org-1",
          status: "pending",
          availableOn: iso(+ONE_HOUR),
          amount: 10_000,
        },
      },
    ]);

    await handler();

    expect(batchedUpdates).toHaveLength(0);
    expect(auditWrites).toHaveLength(0);
  });

  // ─── Boundary — availableOn === now ──────────────────────────────────────

  it("releases an entry whose availableOn is exactly equal to now (inclusive boundary)", async () => {
    seed("balanceTransactions", [
      {
        id: "bt-on-the-tick",
        data: {
          organizationId: "org-1",
          status: "pending",
          availableOn: NOW.toISOString(),
          amount: 12_345,
        },
      },
    ]);

    await handler();

    expect(batchedUpdates).toHaveLength(1);
    expect(batchedUpdates[0]!.patch.status).toBe("available");
  });

  // ─── Per-org aggregation ────────────────────────────────────────────────

  it("emits one audit row per organization, partitioning entries correctly", async () => {
    seed("balanceTransactions", [
      {
        id: "bt-org-a-1",
        data: {
          organizationId: "org-A",
          status: "pending",
          availableOn: iso(-ONE_DAY),
          amount: 10_000,
        },
      },
      {
        id: "bt-org-a-2",
        data: {
          organizationId: "org-A",
          status: "pending",
          availableOn: iso(-ONE_DAY),
          amount: 5_000,
        },
      },
      {
        id: "bt-org-b-1",
        data: {
          organizationId: "org-B",
          status: "pending",
          availableOn: iso(-ONE_DAY),
          amount: 7_500,
        },
      },
    ]);

    await handler();

    expect(batchedUpdates).toHaveLength(3);
    expect(auditWrites).toHaveLength(2);

    const byOrg = new Map(
      auditWrites.map((a) => [
        a.data.organizationId as string,
        a.data.details as Record<string, unknown>,
      ]),
    );
    expect(byOrg.get("org-A")?.count).toBe(2);
    expect(byOrg.get("org-A")?.netAmount).toBe(15_000);
    expect(byOrg.get("org-B")?.count).toBe(1);
    expect(byOrg.get("org-B")?.netAmount).toBe(7_500);
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────

  it("is idempotent — a second run with no due pending entries is a no-op", async () => {
    seed("balanceTransactions", [
      {
        id: "bt-due",
        data: {
          organizationId: "org-1",
          status: "pending",
          availableOn: iso(-ONE_DAY),
          amount: 8_000,
        },
      },
    ]);

    await handler();
    expect(batchedUpdates).toHaveLength(1);
    expect(auditWrites).toHaveLength(1);

    // Reset capture, re-run; the entry is now `available`, so the
    // (status==pending, availableOn<=now) query should return zero docs.
    batchedUpdates.length = 0;
    batchedSets.length = 0;
    auditWrites.length = 0;

    await handler();
    expect(batchedUpdates).toHaveLength(0);
    expect(auditWrites).toHaveLength(0);
  });

  // ─── Empty universe ──────────────────────────────────────────────────────

  it("logs a quiet info and writes nothing when no entries are due", async () => {
    seed("balanceTransactions", []);
    await handler();
    expect(batchedUpdates).toHaveLength(0);
    expect(auditWrites).toHaveLength(0);
  });

  // ─── sampleEntryIds cap (forensics) ──────────────────────────────────────

  it("caps sampleEntryIds at 50 and marks truncated=true when more entries were released", async () => {
    const docs = Array.from({ length: 75 }, (_, i) => ({
      id: `bt-${String(i).padStart(3, "0")}`,
      data: {
        organizationId: "org-1",
        status: "pending",
        availableOn: iso(-ONE_DAY),
        amount: 1_000,
      },
    }));
    seed("balanceTransactions", docs);

    await handler();

    expect(batchedUpdates).toHaveLength(75);
    expect(auditWrites).toHaveLength(1);
    const details = auditWrites[0]!.data.details as Record<string, unknown>;
    expect(details.count).toBe(75);
    expect((details.sampleEntryIds as string[]).length).toBe(50);
    expect(details.truncated).toBe(true);
  });
});
