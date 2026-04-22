import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Post-event feedback trigger tests ─────────────────────────────────────

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Capture every internal-dispatch call so the test can assert fan-out.
const { dispatchCalls } = vi.hoisted(() => ({
  dispatchCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils/internal-dispatch", () => ({
  dispatchInternalChunked: vi.fn(async (req: Record<string, unknown>) => {
    dispatchCalls.push(req);
    return { sent: (req.recipients as unknown[]).length, failed: 0 };
  }),
}));

// ── Firestore fake ────────────────────────────────────────────────────────
// Minimum surface for eventsSnap.get(), regsSnap.get(), and getAll.
// Each `db.collection(name).where(...).get()` returns the configured
// docs bucket keyed by collection name. `db.getAll(...refs)` joins the
// refs against the USERS bucket.

type FakeDoc = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown>;
};

const { collections } = vi.hoisted(() => ({
  collections: new Map<string, FakeDoc[]>(),
}));

function makeDoc(id: string, data: Record<string, unknown> | null): FakeDoc {
  return {
    id,
    exists: data !== null,
    data: () => data ?? {},
  };
}

vi.mock("../../utils/admin", () => {
  function buildQuery(name: string, state: Record<string, unknown>) {
    return {
      where: (field: string, op: string, value: unknown) =>
        buildQuery(name, {
          ...state,
          where: [...((state.where as unknown[]) ?? []), [field, op, value]],
        }),
      get: async () => {
        const all = collections.get(name) ?? [];
        const whereClauses = (state.where as [string, string, unknown][] | undefined) ?? [];
        let filtered = all.filter((d) => d.exists);
        for (const [field, op, value] of whereClauses) {
          if (op === "==") {
            filtered = filtered.filter((d) => d.data()[field] === value);
          } else if (op === ">=") {
            filtered = filtered.filter((d) => {
              const v = d.data()[field];
              return typeof v === "string" && v >= (value as string);
            });
          } else if (op === "<") {
            filtered = filtered.filter((d) => {
              const v = d.data()[field];
              return typeof v === "string" && v < (value as string);
            });
          } else if (op === "in") {
            const allowed = value as unknown[];
            filtered = filtered.filter((d) => allowed.includes(d.data()[field]));
          }
        }
        return { empty: filtered.length === 0, size: filtered.length, docs: filtered };
      },
    };
  }

  return {
    db: {
      collection: (name: string) => ({
        ...buildQuery(name, {}),
        doc: (id: string) => ({
          _collection: name,
          _id: id,
          get: async () => {
            const all = collections.get(name) ?? [];
            return all.find((d) => d.id === id) ?? makeDoc(id, null);
          },
        }),
      }),
      getAll: async (...refs: Array<{ _collection: string; _id: string }>) => {
        return refs.map((ref) => {
          const all = collections.get(ref._collection) ?? [];
          return all.find((d) => d.id === ref._id) ?? makeDoc(ref._id, null);
        });
      },
    },
    COLLECTIONS: {
      EVENTS: "events",
      REGISTRATIONS: "registrations",
      USERS: "users",
    },
  };
});

import { sendPostEventFollowups } from "../post-event.triggers";

const handler = sendPostEventFollowups as unknown as () => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  collections.clear();
  dispatchCalls.length = 0;
});

// Helpers ────────────────────────────────────────────────────────────────
function seed(name: string, docs: Array<{ id: string; data: Record<string, unknown> | null }>) {
  collections.set(
    name,
    docs.map((d) => makeDoc(d.id, d.data)),
  );
}

const NOW = Date.now();
const TWO_H_AGO = new Date(NOW - 2 * 60 * 60 * 1000 - 5 * 60 * 1000).toISOString();
const THREE_H_AGO = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
const ONE_H_AGO = new Date(NOW - 60 * 60 * 1000).toISOString();

describe("sendPostEventFollowups", () => {
  it("dispatches feedback to every checked-in registrant of an event that ended ~2h ago", async () => {
    seed("events", [
      {
        id: "ev-1",
        data: {
          id: "ev-1",
          title: "Dakar Summit",
          slug: "dakar-summit",
          status: "published",
          endDate: TWO_H_AGO,
        },
      },
    ]);
    seed("registrations", [
      { id: "reg-a", data: { eventId: "ev-1", userId: "u-a", status: "checked_in" } },
      { id: "reg-b", data: { eventId: "ev-1", userId: "u-b", status: "checked_in" } },
      // confirmed-but-no-show → must NOT be surveyed
      { id: "reg-c", data: { eventId: "ev-1", userId: "u-c", status: "confirmed" } },
    ]);
    seed("users", [
      { id: "u-a", data: { email: "a@test.com", preferredLanguage: "fr" } },
      { id: "u-b", data: { email: "b@test.com", preferredLanguage: "en" } },
      { id: "u-c", data: { email: "c@test.com", preferredLanguage: "fr" } },
    ]);

    await handler();

    // One dispatch per checked-in user (2 total)
    expect(dispatchCalls).toHaveLength(2);
    for (const call of dispatchCalls) {
      expect(call.key).toBe("event.feedback_requested");
      const recipients = call.recipients as Array<{ userId?: string }>;
      expect(recipients).toHaveLength(1);
    }
    const userIds = dispatchCalls.map(
      (c) => (c.recipients as Array<{ userId: string }>)[0]?.userId,
    );
    expect(new Set(userIds)).toEqual(new Set(["u-a", "u-b"]));
    // Idempotency keys are deterministic per user+event — lets retries dedup.
    const idempotency = dispatchCalls.map((c) => c.idempotencyKey);
    expect(idempotency).toContain("event-feedback/ev-1/u-a");
    expect(idempotency).toContain("event-feedback/ev-1/u-b");
  });

  it("skips events outside the 2h–2h15m window", async () => {
    seed("events", [
      // 3h ago — missed the window
      { id: "ev-old", data: { status: "published", endDate: THREE_H_AGO, title: "Old" } },
      // 1h ago — too recent
      { id: "ev-recent", data: { status: "published", endDate: ONE_H_AGO, title: "Recent" } },
    ]);
    seed("registrations", [
      { id: "reg-old", data: { eventId: "ev-old", userId: "u-a", status: "checked_in" } },
      { id: "reg-recent", data: { eventId: "ev-recent", userId: "u-b", status: "checked_in" } },
    ]);
    seed("users", [{ id: "u-a", data: { email: "a@test.com", preferredLanguage: "fr" } }]);

    await handler();

    expect(dispatchCalls).toHaveLength(0);
  });

  it("no-ops when no events are in the window", async () => {
    seed("events", []);
    await handler();
    expect(dispatchCalls).toHaveLength(0);
  });

  it("skips users without an email on file", async () => {
    seed("events", [
      { id: "ev-1", data: { status: "published", endDate: TWO_H_AGO, title: "Event" } },
    ]);
    seed("registrations", [
      { id: "reg-a", data: { eventId: "ev-1", userId: "u-a", status: "checked_in" } },
      { id: "reg-b", data: { eventId: "ev-1", userId: "u-b", status: "checked_in" } },
    ]);
    seed("users", [
      { id: "u-a", data: { email: "a@test.com", preferredLanguage: "fr" } },
      // u-b has no user doc at all — should be silently dropped
    ]);

    await handler();
    expect(dispatchCalls).toHaveLength(1);
  });
});
