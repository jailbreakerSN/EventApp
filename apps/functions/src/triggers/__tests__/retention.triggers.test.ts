import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Firestore fake ─────────────────────────────────────────────────────
// Minimum viable surface for a query+batch pipeline. Each `db.collection(n)`
// returns a chainable query with `.where / .orderBy / .limit / .startAfter`,
// ending in `.get()` which returns the configured docs bucket for that
// collection. `db.batch()` accumulates `.delete(ref)` calls and records the
// set of deleted doc ids on `.commit()`.
//
// Docs are pre-loaded per collection via `seed(...)`. A batch commit
// actually removes deleted docs from the seeded array, so subsequent
// queries against the same collection don't see them (mirrors Firestore
// behaviour for the retention pagination loop).

type FakeDoc = {
  id: string;
  data: () => Record<string, unknown>;
  ref: { id: string };
};

const { collections, batchedDeletes, lastQueries } = vi.hoisted(() => ({
  collections: new Map<string, FakeDoc[]>(),
  batchedDeletes: [] as string[][],
  lastQueries: new Map<string, Record<string, unknown>>(),
}));

function makeDoc(id: string, data: Record<string, unknown>): FakeDoc {
  return { id, data: () => data, ref: { id } };
}

vi.mock("../../utils/admin", () => {
  function buildQuery(name: string, state: Record<string, unknown>) {
    return {
      where: (field: string, op: string, value: unknown) =>
        buildQuery(name, {
          ...state,
          where: [...((state.where as unknown[]) ?? []), [field, op, value]],
        }),
      orderBy: (field: string) => buildQuery(name, { ...state, orderBy: field }),
      limit: (n: number) => buildQuery(name, { ...state, limit: n }),
      startAfter: (doc: FakeDoc) => buildQuery(name, { ...state, startAfter: doc.id }),
      get: async () => {
        lastQueries.set(name, state);
        const all = collections.get(name) ?? [];
        // Apply age filter if present.
        let filtered = all;
        const whereClauses = (state.where as [string, string, unknown][] | undefined) ?? [];
        for (const [field, op, value] of whereClauses) {
          if (op === "<") {
            filtered = filtered.filter((d) => {
              const v = d.data()[field];
              return typeof v === "string" && v < (value as string);
            });
          }
        }
        // Apply startAfter + limit.
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
      collection: (name: string) => buildQuery(name, {}),
      batch: () => {
        const pending: FakeDoc[] = [];
        return {
          delete: (ref: { id: string }) => {
            const all = collections.get(ref.id.split(":")[0] ?? "") ?? [];
            const found =
              all.find((d) => d.id === ref.id) ??
              // refs carry only {id}, so find by id across all collections
              [...collections.values()].flat().find((d) => d.id === ref.id);
            if (found) pending.push(found);
          },
          commit: async () => {
            batchedDeletes.push(pending.map((d) => d.id));
            // Actually remove so subsequent queries don't see them.
            for (const [name, docs] of collections.entries()) {
              collections.set(
                name,
                docs.filter((d) => !pending.some((p) => p.id === d.id)),
              );
            }
          },
        };
      },
    },
    COLLECTIONS: {
      NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
      EMAIL_LOG: "emailLog",
    },
  };
});

import { runRetentionPolicies } from "../retention.triggers";

function seed(collection: string, docs: Array<{ id: string; data: Record<string, unknown> }>) {
  collections.set(
    collection,
    docs.map((d) => makeDoc(d.id, d.data)),
  );
}

const handler = runRetentionPolicies as unknown as () => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  collections.clear();
  batchedDeletes.length = 0;
  lastQueries.clear();
});

// Pre-compute anchor timestamps relative to "now" for readable fixtures.
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const DAYS = 24 * 60 * 60 * 1000;

describe("runRetentionPolicies", () => {
  // ─── pending-subscriber pruning ─────────────────────────────────────────

  it("deletes pending newsletterSubscribers older than 30 days", async () => {
    seed("newsletterSubscribers", [
      { id: "p-40d", data: { status: "pending", createdAt: iso(now - 40 * DAYS) } },
      { id: "p-45d", data: { status: "pending", createdAt: iso(now - 45 * DAYS) } },
    ]);

    await handler();

    // Both old pending rows were deleted in a single batch.
    expect(batchedDeletes.flat().sort()).toEqual(["p-40d", "p-45d"]);
    expect(collections.get("newsletterSubscribers")).toEqual([]);
  });

  it("preserves CONFIRMED subscribers even when older than the cutoff (consent trail)", async () => {
    seed("newsletterSubscribers", [
      { id: "confirmed-90d", data: { status: "confirmed", createdAt: iso(now - 90 * DAYS) } },
      { id: "pending-40d", data: { status: "pending", createdAt: iso(now - 40 * DAYS) } },
    ]);

    await handler();

    // Only the pending row was pruned; the confirmed row stays for CASL
    // 3-year consent record compliance.
    expect(batchedDeletes.flat()).toEqual(["pending-40d"]);
    const remaining = collections.get("newsletterSubscribers")?.map((d) => d.id);
    expect(remaining).toEqual(["confirmed-90d"]);
  });

  it("preserves UNSUBSCRIBED subscribers regardless of age", async () => {
    seed("newsletterSubscribers", [
      { id: "unsub-120d", data: { status: "unsubscribed", createdAt: iso(now - 120 * DAYS) } },
      { id: "pending-31d", data: { status: "pending", createdAt: iso(now - 31 * DAYS) } },
    ]);

    await handler();

    expect(batchedDeletes.flat()).toEqual(["pending-31d"]);
    expect(collections.get("newsletterSubscribers")?.map((d) => d.id)).toEqual(["unsub-120d"]);
  });

  it("leaves recent pending subscribers alone (< 30d)", async () => {
    seed("newsletterSubscribers", [
      { id: "pending-5d", data: { status: "pending", createdAt: iso(now - 5 * DAYS) } },
      { id: "pending-29d", data: { status: "pending", createdAt: iso(now - 29 * DAYS) } },
    ]);

    await handler();

    // Query returned zero rows (no row older than 30 days); no batch
    // commit should have run for this collection.
    expect(batchedDeletes.flat()).toEqual([]);
    expect(collections.get("newsletterSubscribers")?.map((d) => d.id)).toEqual([
      "pending-5d",
      "pending-29d",
    ]);
  });

  // ─── email-log pruning ─────────────────────────────────────────────────

  it("deletes emailLog rows older than 90 days without a status filter", async () => {
    seed("emailLog", [
      { id: "log-95d", data: { createdAt: iso(now - 95 * DAYS) } },
      { id: "log-200d", data: { createdAt: iso(now - 200 * DAYS) } },
      { id: "log-80d", data: { createdAt: iso(now - 80 * DAYS) } },
    ]);

    await handler();

    expect(batchedDeletes.flat().sort()).toEqual(["log-200d", "log-95d"]);
    expect(collections.get("emailLog")?.map((d) => d.id)).toEqual(["log-80d"]);
  });

  // ─── pagination + cursor behaviour ──────────────────────────────────────

  it("paginates via startAfter when a confirmed row sits between pending ones", async () => {
    // Layout chronologically:
    //   pending-60d, confirmed-55d, pending-50d
    // All three match the age filter (< 30d cutoff). First page (batch
    // size is large) returns all three; the confirmed row is skipped
    // in-memory and the two pending rows get deleted together.
    seed("newsletterSubscribers", [
      { id: "pending-60d", data: { status: "pending", createdAt: iso(now - 60 * DAYS) } },
      { id: "confirmed-55d", data: { status: "confirmed", createdAt: iso(now - 55 * DAYS) } },
      { id: "pending-50d", data: { status: "pending", createdAt: iso(now - 50 * DAYS) } },
    ]);

    await handler();

    expect(batchedDeletes.flat().sort()).toEqual(["pending-50d", "pending-60d"]);
    expect(collections.get("newsletterSubscribers")?.map((d) => d.id)).toEqual(["confirmed-55d"]);
  });

  it("is idempotent — a second run with nothing old to delete is a no-op", async () => {
    seed("newsletterSubscribers", [
      { id: "pending-40d", data: { status: "pending", createdAt: iso(now - 40 * DAYS) } },
    ]);

    await handler();
    expect(batchedDeletes.flat()).toEqual(["pending-40d"]);

    // Reset the capture; the second run should find nothing.
    batchedDeletes.length = 0;
    await handler();
    expect(batchedDeletes.flat()).toEqual([]);
  });

  it("handles both collections in a single run (no interference)", async () => {
    seed("newsletterSubscribers", [
      { id: "sub-old-pending", data: { status: "pending", createdAt: iso(now - 45 * DAYS) } },
      { id: "sub-kept", data: { status: "confirmed", createdAt: iso(now - 200 * DAYS) } },
    ]);
    seed("emailLog", [{ id: "log-old", data: { createdAt: iso(now - 100 * DAYS) } }]);

    await handler();

    const deleted = batchedDeletes.flat().sort();
    expect(deleted).toEqual(["log-old", "sub-old-pending"]);
    expect(collections.get("newsletterSubscribers")?.map((d) => d.id)).toEqual(["sub-kept"]);
    expect(collections.get("emailLog")).toEqual([]);
  });
});
