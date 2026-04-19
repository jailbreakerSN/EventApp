import { describe, it, expect, vi } from "vitest";
import { applyScheduledRollovers } from "../subscription-rollover";

// ─── Firestore stub ─────────────────────────────────────────────────────────
//
// The worker does:
//   db.collection("subscriptions").where("scheduledChange.effectiveAt","<=",now).get()
//   db.collection("plans").get()
//   db.runTransaction(async tx => { tx.get(subRef), tx.update, tx.get(orgRef), tx.update })
//
// We mock each of those, per-test. Keeps the unit scope tight — Firestore
// semantics are integration-tested via the emulator path, not here.

interface StubDoc<T> {
  id: string;
  data: () => T;
  ref: { update?: ReturnType<typeof vi.fn> };
  exists: boolean;
}

function buildStubDb(config: {
  dueSubscriptions: StubDoc<Record<string, unknown>>[];
  plans: StubDoc<Record<string, unknown>>[];
  txReadsBySubId?: Record<string, Record<string, unknown>>;
  txOrgRead?: Record<string, unknown>;
  txGet?: ReturnType<typeof vi.fn>;
  txUpdate?: ReturnType<typeof vi.fn>;
  txSet?: ReturnType<typeof vi.fn>;
}) {
  const txUpdate = config.txUpdate ?? vi.fn();
  const txSet = config.txSet ?? vi.fn();
  const txGet =
    config.txGet ??
    vi.fn(async (ref: { __kind: string; __id?: string }) => {
      if (ref.__kind === "subscription" && ref.__id) {
        const data = config.txReadsBySubId?.[ref.__id];
        return {
          exists: !!data,
          id: ref.__id,
          data: () => data,
        };
      }
      if (ref.__kind === "organization") {
        return {
          exists: !!config.txOrgRead,
          id: "org-1",
          data: () => config.txOrgRead,
        };
      }
      return { exists: false };
    });

  const collection = vi.fn((name: string) => ({
    where: () => ({
      get: async () => ({
        empty: config.dueSubscriptions.length === 0,
        size: config.dueSubscriptions.length,
        docs: config.dueSubscriptions,
      }),
    }),
    get: async () => ({
      empty: config.plans.length === 0,
      size: config.plans.length,
      docs: config.plans,
    }),
    doc: (id: string) => ({
      __kind: name === "subscriptions" ? "subscription" : "organization",
      __id: id,
    }),
  }));

  const runTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ get: txGet, update: txUpdate, set: txSet });
  });

  return {
    db: {
      collection,
      runTransaction,
    } as unknown as Parameters<typeof applyScheduledRollovers>[0],
    txGet,
    txUpdate,
    txSet,
    runTransaction,
  };
}

function planDoc(
  id: string,
  overrides: Record<string, unknown> = {},
): StubDoc<Record<string, unknown>> {
  return {
    id,
    exists: true,
    ref: {},
    data: () => ({
      key: id,
      name: { fr: id, en: id },
      pricingModel: "fixed",
      priceXof: id === "pro" ? 29900 : id === "starter" ? 9900 : 0,
      currency: "XOF",
      limits:
        id === "pro"
          ? { maxEvents: -1, maxParticipantsPerEvent: 2000, maxMembers: 50 }
          : id === "starter"
            ? { maxEvents: 10, maxParticipantsPerEvent: 200, maxMembers: 3 }
            : { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1 },
      features: {
        qrScanning: id !== "free",
        paidTickets: id === "pro",
        customBadges: id !== "free",
        csvExport: id !== "free",
        smsNotifications: id === "pro",
        advancedAnalytics: id === "pro",
        speakerPortal: id === "pro",
        sponsorPortal: id === "pro",
        apiAccess: false,
        whiteLabel: false,
        promoCodes: id !== "free",
      },
      isSystem: true,
      isPublic: true,
      isArchived: false,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    }),
  };
}

function subDoc(id: string, data: Record<string, unknown>): StubDoc<Record<string, unknown>> {
  return { id, exists: true, ref: {}, data: () => data };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("applyScheduledRollovers", () => {
  const past = "2026-06-01T00:00:00.000Z";
  const future = "2099-01-01T00:00:00.000Z";
  const now = new Date("2026-06-02T00:00:00.000Z");

  it("does nothing when no subscriptions are due", async () => {
    const stub = buildStubDb({ dueSubscriptions: [], plans: [planDoc("free")] });
    const result = await applyScheduledRollovers(stub.db, { now });
    expect(result).toEqual({ scanned: 0, rolledOver: 0, skipped: 0, errors: [] });
  });

  it("rolls over a due subscription and calls onRolledOver", async () => {
    const scheduledSub = {
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: past,
      scheduledChange: {
        toPlan: "free",
        effectiveAt: past,
        reason: "cancel",
        scheduledBy: "user-1",
        scheduledAt: past,
      },
    };
    const stub = buildStubDb({
      dueSubscriptions: [subDoc("sub-1", scheduledSub)],
      plans: [planDoc("free"), planDoc("pro")],
      txReadsBySubId: { "sub-1": scheduledSub },
      txOrgRead: { id: "org-1", plan: "pro" },
    });

    const onRolledOver = vi.fn();
    const result = await applyScheduledRollovers(stub.db, { now, onRolledOver });

    expect(result.rolledOver).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(onRolledOver).toHaveBeenCalledWith({
      organizationId: "org-1",
      fromPlan: "pro",
      toPlan: "free",
      reason: "cancel",
    });
    // Tx update was called twice: once for the subscription, once for the org
    expect(stub.txUpdate).toHaveBeenCalledTimes(2);
  });

  it("skips subs whose scheduledChange was cleared between query and tx", async () => {
    const stub = buildStubDb({
      dueSubscriptions: [
        subDoc("sub-1", {
          organizationId: "org-1",
          plan: "pro",
          scheduledChange: {
            toPlan: "free",
            effectiveAt: past,
            reason: "cancel",
            scheduledBy: "u",
            scheduledAt: past,
          },
        }),
      ],
      plans: [planDoc("free"), planDoc("pro")],
      // Fresh read inside the transaction returns no scheduledChange — raced
      // by a concurrent revert.
      txReadsBySubId: {
        "sub-1": { organizationId: "org-1", plan: "pro", status: "active" },
      },
    });

    const result = await applyScheduledRollovers(stub.db, { now });
    expect(result.rolledOver).toBe(0);
    expect(result.skipped).toBe(1);
    expect(stub.txUpdate).not.toHaveBeenCalled();
  });

  it("skips past_due subscriptions — dunning owns their lifecycle", async () => {
    const scheduledSub = {
      organizationId: "org-1",
      plan: "pro",
      status: "past_due",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: past,
        reason: "cancel",
        scheduledBy: "u",
        scheduledAt: past,
      },
    };
    const stub = buildStubDb({
      dueSubscriptions: [subDoc("sub-1", scheduledSub)],
      plans: [planDoc("free")],
      txReadsBySubId: { "sub-1": scheduledSub },
    });

    const result = await applyScheduledRollovers(stub.db, { now });
    expect(result.rolledOver).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips when effectiveAt is actually still in the future at tx-read time", async () => {
    // Query may have matched (e.g. effectiveAt field was edited to past
    // briefly) but by the time we re-read inside the transaction it's in the
    // future again — respect the new reality.
    const scheduledSub = {
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: future,
        reason: "cancel",
        scheduledBy: "u",
        scheduledAt: past,
      },
    };
    const stub = buildStubDb({
      dueSubscriptions: [subDoc("sub-1", scheduledSub)],
      plans: [planDoc("free")],
      txReadsBySubId: { "sub-1": scheduledSub },
    });

    const result = await applyScheduledRollovers(stub.db, { now });
    expect(result.rolledOver).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("continues processing after a per-row transaction failure", async () => {
    // First sub: tx throws. Second sub: succeeds.
    const sub1 = {
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: past,
        reason: "cancel",
        scheduledBy: "u",
        scheduledAt: past,
      },
    };
    const sub2 = {
      organizationId: "org-2",
      plan: "starter",
      status: "active",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: past,
        reason: "cancel",
        scheduledBy: "u",
        scheduledAt: past,
      },
    };

    const runTransaction = vi
      .fn()
      // First call throws
      .mockRejectedValueOnce(new Error("boom"))
      // Second call runs normally
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txGet = vi.fn(async (ref: { __kind: string; __id?: string }) => {
          if (ref.__kind === "subscription")
            return { exists: true, id: ref.__id, data: () => sub2 };
          return { exists: true, id: "org-2", data: () => ({ plan: "starter" }) };
        });
        return fn({ get: txGet, update: vi.fn(), set: vi.fn() });
      });

    const collection = vi.fn((name: string) => ({
      where: () => ({
        get: async () => ({
          empty: false,
          size: 2,
          docs: [subDoc("sub-1", sub1), subDoc("sub-2", sub2)],
        }),
      }),
      get: async () => ({
        empty: false,
        size: 1,
        docs: [planDoc("free"), planDoc("starter")],
      }),
      doc: (id: string) => ({
        __kind: name === "subscriptions" ? "subscription" : "organization",
        __id: id,
      }),
    }));

    const db = {
      collection,
      runTransaction,
    } as unknown as Parameters<typeof applyScheduledRollovers>[0];

    const result = await applyScheduledRollovers(db, { now });
    expect(result.rolledOver).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].subscriptionId).toBe("sub-1");
  });
});
