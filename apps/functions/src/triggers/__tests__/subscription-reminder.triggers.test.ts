import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Subscription reminder trigger tests ───────────────────────────────────

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { dispatchCalls } = vi.hoisted(() => ({
  dispatchCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils/internal-dispatch", () => ({
  dispatchInternalChunked: vi.fn(async (req: Record<string, unknown>) => {
    dispatchCalls.push(req);
    return { sent: (req.recipients as unknown[]).length, failed: 0 };
  }),
}));

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
          if (op === "==") filtered = filtered.filter((d) => d.data()[field] === value);
          else if (op === "in") {
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
      ORGANIZATIONS: "organizations",
      USERS: "users",
      SUBSCRIPTIONS: "subscriptions",
    },
  };
});

import { sendSubscriptionReminders } from "../subscription-reminder.triggers";

const handler = sendSubscriptionReminders as unknown as () => Promise<void>;

function seed(name: string, docs: Array<{ id: string; data: Record<string, unknown> | null }>) {
  collections.set(
    name,
    docs.map((d) => makeDoc(d.id, d.data)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  collections.clear();
  dispatchCalls.length = 0;
});

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("sendSubscriptionReminders", () => {
  it("emits subscription.expiring_soon exactly when renewal is 7 days away", async () => {
    seed("subscriptions", [
      {
        id: "sub-1",
        data: {
          organizationId: "org-1",
          plan: "pro",
          status: "active",
          currentPeriodEnd: daysFromNowIso(7),
          priceXof: 29900,
        },
      },
    ]);
    seed("organizations", [
      { id: "org-1", data: { id: "org-1", name: "Teranga", ownerId: "u-owner", memberIds: [] } },
    ]);
    seed("users", [
      { id: "u-owner", data: { email: "owner@test.com", preferredLanguage: "fr" } },
    ]);
    seed("events", []);

    await handler();

    const calls = dispatchCalls.filter((c) => c.key === "subscription.expiring_soon");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect((call.params as Record<string, unknown>).planKey).toBe("pro");
    expect((call.params as Record<string, unknown>).daysUntilRenewal).toBe(7);
    expect(call.idempotencyKey).toContain("subscription-expiring-soon/org-1/");
  });

  it("does NOT emit expiring_soon when renewal is 6 or 8 days away", async () => {
    seed("subscriptions", [
      {
        id: "sub-6d",
        data: {
          organizationId: "org-1",
          plan: "pro",
          status: "active",
          currentPeriodEnd: daysFromNowIso(6),
          priceXof: 29900,
        },
      },
      {
        id: "sub-8d",
        data: {
          organizationId: "org-2",
          plan: "pro",
          status: "active",
          currentPeriodEnd: daysFromNowIso(8),
          priceXof: 29900,
        },
      },
    ]);
    seed("organizations", [
      { id: "org-1", data: { ownerId: "u-o", memberIds: [] } },
      { id: "org-2", data: { ownerId: "u-o", memberIds: [] } },
    ]);
    seed("users", [{ id: "u-o", data: { email: "o@test.com", preferredLanguage: "fr" } }]);
    seed("events", []);

    await handler();
    const expiring = dispatchCalls.filter((c) => c.key === "subscription.expiring_soon");
    expect(expiring).toHaveLength(0);
  });

  it("skips free-plan subscriptions entirely", async () => {
    seed("subscriptions", [
      {
        id: "sub-free",
        data: {
          organizationId: "org-1",
          plan: "free",
          status: "active",
          currentPeriodEnd: daysFromNowIso(7),
          priceXof: 0,
        },
      },
    ]);
    seed("organizations", [{ id: "org-1", data: { ownerId: "u-o", memberIds: [] } }]);
    seed("users", [{ id: "u-o", data: { email: "o@test.com", preferredLanguage: "fr" } }]);
    seed("events", []);

    await handler();
    expect(dispatchCalls).toHaveLength(0);
  });

  it("emits subscription.approaching_limit when an event cap is >= 80% used", async () => {
    // Starter cap: maxEvents=10. 8 events → 80%.
    seed("subscriptions", [
      {
        id: "sub-1",
        data: {
          organizationId: "org-1",
          plan: "starter",
          status: "active",
          // renewal 100 days out so expiring_soon is not triggered
          currentPeriodEnd: daysFromNowIso(100),
          priceXof: 9900,
        },
      },
    ]);
    seed("organizations", [
      { id: "org-1", data: { id: "org-1", name: "Hub", ownerId: "u-o", memberIds: [] } },
    ]);
    seed("users", [{ id: "u-o", data: { email: "o@test.com", preferredLanguage: "fr" } }]);
    seed("events", [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `ev-${i}`,
        data: {
          organizationId: "org-1",
          status: "published",
          registeredCount: 10,
        } as Record<string, unknown>,
      })),
    ]);

    await handler();
    const calls = dispatchCalls.filter((c) => c.key === "subscription.approaching_limit");
    // events dimension should trigger (8/10 = 80%)
    const eventsCall = calls.find(
      (c) => (c.params as Record<string, unknown>).dimension === "events",
    );
    expect(eventsCall).toBeDefined();
    expect((eventsCall!.params as Record<string, unknown>).current).toBe("8");
    expect((eventsCall!.params as Record<string, unknown>).limit).toBe("10");
    // Idempotency includes date-stamp
    expect(String(eventsCall!.idempotencyKey)).toMatch(
      /^subscription-approaching-limit\/org-1\/events\/\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("does NOT emit approaching_limit at 79% usage", async () => {
    // Pro cap: maxMembers=50. 39 members → 78%.
    seed("subscriptions", [
      {
        id: "sub-1",
        data: {
          organizationId: "org-1",
          plan: "pro",
          status: "active",
          currentPeriodEnd: daysFromNowIso(100),
          priceXof: 29900,
        },
      },
    ]);
    seed("organizations", [
      {
        id: "org-1",
        data: {
          id: "org-1",
          name: "Hub",
          ownerId: "u-o",
          memberIds: Array.from({ length: 38 }, (_, i) => `m-${i}`),
        },
      },
    ]);
    seed("users", [{ id: "u-o", data: { email: "o@test.com", preferredLanguage: "fr" } }]);
    seed("events", []);

    await handler();
    expect(dispatchCalls).toHaveLength(0);
  });
});
