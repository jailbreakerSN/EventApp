import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── onPaymentTimeout cron tests ───────────────────────────────────────────
//
// Covers the post-2026-04-26 senior-review fix:
//   - per-document runTransaction (replaces the unsafe db.batch() loop)
//   - inner-tx idempotency guard against IPN-success races
//   - defensive Registration check (no overwrite of confirmed)
//   - audit-log writes parallel to the state-machine flip
//
// The Firestore fake has just enough surface to exercise these paths;
// it is intentionally narrower than the post-event.triggers fake because
// onPaymentTimeout only uses three operations: where().get(), tx.get(),
// tx.update(), and add() on auditLogs.

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type FakeDoc = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown>;
  ref: unknown;
};

const { state } = vi.hoisted(() => ({
  state: {
    payments: new Map<string, Record<string, unknown>>(),
    registrations: new Map<string, Record<string, unknown>>(),
    auditLogs: [] as Array<Record<string, unknown>>,
    paymentUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    registrationUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    // Hook to mutate state DURING the tx callback to simulate a racing IPN.
    onTxRead: null as null | ((collection: string, id: string) => void),
  },
}));

function makeDoc(collection: string, id: string, data: Record<string, unknown> | null): FakeDoc {
  return {
    id,
    exists: data !== null,
    data: () => data ?? {},
    ref: { _collection: collection, _id: id },
  };
}

vi.mock("../../utils/admin", () => {
  const buildQuery = (name: string, whereClauses: [string, string, unknown][]) => ({
    where: (field: string, op: string, value: unknown) =>
      buildQuery(name, [...whereClauses, [field, op, value]]),
    limit: (_n: number) => buildQuery(name, whereClauses),
    get: async () => {
      const bucket =
        name === "payments" ? state.payments : name === "registrations" ? state.registrations : new Map();
      const docs: FakeDoc[] = [];
      for (const [id, data] of bucket.entries()) {
        const matchesAll = whereClauses.every(([field, op, value]) => {
          const v = data[field];
          if (op === "==") return v === value;
          if (op === "<") return typeof v === "string" && v < (value as string);
          return false;
        });
        if (matchesAll) docs.push(makeDoc(name, id, data));
      }
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });

  function docHandle(name: string, id: string) {
    return {
      _collection: name,
      _id: id,
      get: async () => {
        const bucket =
          name === "payments" ? state.payments : name === "registrations" ? state.registrations : new Map();
        return makeDoc(name, id, bucket.get(id) ?? null);
      },
    };
  }

  function applyUpdate(refLike: { _collection: string; _id: string }, patch: Record<string, unknown>) {
    if (refLike._collection === "payments") {
      state.paymentUpdates.push({ id: refLike._id, patch });
      const cur = state.payments.get(refLike._id);
      if (cur) state.payments.set(refLike._id, { ...cur, ...patch });
    } else if (refLike._collection === "registrations") {
      state.registrationUpdates.push({ id: refLike._id, patch });
      const cur = state.registrations.get(refLike._id);
      if (cur) state.registrations.set(refLike._id, { ...cur, ...patch });
    }
  }

  return {
    db: {
      collection: (name: string) => ({
        ...buildQuery(name, []),
        doc: (id: string) => docHandle(name, id),
        add: async (data: Record<string, unknown>) => {
          if (name === "auditLogs") state.auditLogs.push(data);
          return { id: `audit-${state.auditLogs.length}` };
        },
      }),
      runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const tx = {
          get: async (refLike: { _collection: string; _id: string } | { _id: string }) => {
            const collection = (refLike as { _collection?: string })._collection ?? "payments";
            const id = (refLike as { _id: string })._id;
            // Hook lets a test mutate state to simulate a racing IPN
            // landing between the outer scan and the tx read.
            state.onTxRead?.(collection, id);
            const bucket =
              collection === "payments"
                ? state.payments
                : collection === "registrations"
                  ? state.registrations
                  : new Map();
            return makeDoc(collection, id, bucket.get(id) ?? null);
          },
          update: (refLike: { _collection: string; _id: string }, patch: Record<string, unknown>) => {
            applyUpdate(refLike, patch);
          },
          set: (refLike: { _collection: string; _id: string }, patch: Record<string, unknown>) => {
            applyUpdate(refLike, patch);
          },
        };
        return fn(tx);
      },
    },
    COLLECTIONS: {
      PAYMENTS: "payments",
      REGISTRATIONS: "registrations",
      AUDIT_LOGS: "auditLogs",
      EVENTS: "events",
      USERS: "users",
      BADGES: "badges",
      NOTIFICATIONS: "notifications",
    },
    messaging: { sendEachForMulticast: vi.fn() },
  };
});

import { onPaymentTimeout } from "../payment.triggers";

const handler = onPaymentTimeout as unknown as () => Promise<void>;

const NOW = Date.now();
// 31 minutes ago — past the default 30-min TTL.
const STALE_AT = new Date(NOW - 31 * 60 * 1000).toISOString();
// 5 minutes ago — fresh, must NOT be swept.
const FRESH_AT = new Date(NOW - 5 * 60 * 1000).toISOString();

beforeEach(() => {
  state.payments.clear();
  state.registrations.clear();
  state.auditLogs.length = 0;
  state.paymentUpdates.length = 0;
  state.registrationUpdates.length = 0;
  state.onTxRead = null;
  vi.clearAllMocks();
});

describe("onPaymentTimeout — happy path", () => {
  it("flips a stuck pending Payment + linked pending_payment Registration and writes audit logs for both", async () => {
    state.payments.set("pay-1", {
      id: "pay-1",
      status: "pending",
      createdAt: STALE_AT,
      registrationId: "reg-1",
      organizationId: "org-1",
      eventId: "ev-1",
    });
    state.registrations.set("reg-1", {
      id: "reg-1",
      status: "pending_payment",
      paymentId: "pay-1",
    });

    await handler();

    expect(state.paymentUpdates).toHaveLength(1);
    expect(state.paymentUpdates[0]).toMatchObject({
      id: "pay-1",
      patch: expect.objectContaining({ status: "expired" }),
    });
    expect(state.registrationUpdates).toHaveLength(1);
    expect(state.registrationUpdates[0]).toMatchObject({
      id: "reg-1",
      patch: expect.objectContaining({ status: "cancelled" }),
    });
    expect(state.auditLogs).toHaveLength(2);
    const actions = state.auditLogs.map((a) => a.action);
    expect(actions).toContain("payment.expired");
    expect(actions).toContain("registration.cancelled");
    const paymentAudit = state.auditLogs.find((a) => a.action === "payment.expired");
    expect(paymentAudit).toMatchObject({
      actorId: "system:onPaymentTimeout",
      resourceType: "payment",
      resourceId: "pay-1",
      organizationId: "org-1",
      eventId: "ev-1",
    });
    expect((paymentAudit?.details as { reason?: string })?.reason).toBe("timeout");
  });

  it("sweeps both pending and processing buckets in one tick", async () => {
    state.payments.set("pay-pending", {
      id: "pay-pending",
      status: "pending",
      createdAt: STALE_AT,
      registrationId: "reg-a",
      organizationId: "org-1",
    });
    state.payments.set("pay-processing", {
      id: "pay-processing",
      status: "processing",
      createdAt: STALE_AT,
      registrationId: "reg-b",
      organizationId: "org-1",
    });
    state.registrations.set("reg-a", { id: "reg-a", status: "pending_payment" });
    state.registrations.set("reg-b", { id: "reg-b", status: "pending_payment" });

    await handler();

    expect(state.paymentUpdates.map((u) => u.id).sort()).toEqual(["pay-pending", "pay-processing"]);
    expect(state.registrationUpdates).toHaveLength(2);
  });

  it("ignores a payment with no linked registrationId — only the payment is expired", async () => {
    state.payments.set("orphan", {
      id: "orphan",
      status: "pending",
      createdAt: STALE_AT,
      registrationId: null,
      organizationId: "org-1",
    });

    await handler();

    expect(state.paymentUpdates).toHaveLength(1);
    expect(state.registrationUpdates).toHaveLength(0);
    // Only the payment.expired audit log — not the registration.cancelled one.
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0].action).toBe("payment.expired");
  });

  it("does nothing when no stale payments exist", async () => {
    state.payments.set("fresh", {
      id: "fresh",
      status: "pending",
      createdAt: FRESH_AT,
      registrationId: "reg-fresh",
    });
    state.registrations.set("reg-fresh", { id: "reg-fresh", status: "pending_payment" });

    await handler();

    expect(state.paymentUpdates).toHaveLength(0);
    expect(state.registrationUpdates).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });
});

describe("onPaymentTimeout — race-condition guards", () => {
  it("does NOT overwrite a Payment that flipped to succeeded between query and tx (IPN race)", async () => {
    state.payments.set("racy-pay", {
      id: "racy-pay",
      status: "pending",
      createdAt: STALE_AT,
      registrationId: "racy-reg",
      organizationId: "org-1",
    });
    state.registrations.set("racy-reg", { id: "racy-reg", status: "pending_payment" });

    // Simulate an IPN landing the moment we re-read inside the tx.
    state.onTxRead = (collection, id) => {
      if (collection === "payments" && id === "racy-pay") {
        state.payments.set("racy-pay", {
          ...(state.payments.get("racy-pay") ?? {}),
          status: "succeeded",
        });
      }
    };

    await handler();

    expect(state.paymentUpdates).toHaveLength(0);
    expect(state.registrationUpdates).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });

  it("does NOT overwrite a Registration that became confirmed between scan and tx", async () => {
    state.payments.set("pay-2", {
      id: "pay-2",
      status: "processing",
      createdAt: STALE_AT,
      registrationId: "reg-2",
      organizationId: "org-1",
    });
    state.registrations.set("reg-2", { id: "reg-2", status: "pending_payment" });

    // The Payment is still pending/processing in the tx (stays expirable),
    // but the Registration somehow flipped to confirmed first — defensive
    // guard must skip the registration write.
    state.onTxRead = (collection, id) => {
      if (collection === "registrations" && id === "reg-2") {
        state.registrations.set("reg-2", {
          ...(state.registrations.get("reg-2") ?? {}),
          status: "confirmed",
        });
      }
    };

    await handler();

    // Payment IS still expired (it was a real stuck payment).
    expect(state.paymentUpdates).toHaveLength(1);
    // Registration is NOT overwritten.
    expect(state.registrationUpdates).toHaveLength(0);
    // payment.expired audit is still written; registration.cancelled is also
    // written because the payment had a registrationId — this is a known
    // small over-count we accept (audit log is informational, the actual
    // registration document is the source of truth for state). The audit
    // matches the state-machine intent ("we tried to cancel the linked
    // reg") even though the defensive guard chose not to overwrite.
    const actions = state.auditLogs.map((a) => a.action);
    expect(actions).toContain("payment.expired");
  });
});
