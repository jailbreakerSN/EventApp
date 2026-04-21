import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks of the Firebase v2 wrappers — make each wrapper return the raw
// handler so tests can invoke it with a fake request. Applies to every
// test file in this directory.
vi.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({
    name,
    value: () => secretValueOverride,
  }),
}));

// Mutable secret for per-test control — the signing secret starts as the
// "pending-bootstrap" placeholder and gets flipped to a real whsec value
// once bootstrap runs. Tests flex both paths.
let secretValueOverride = "whsec_valid";

// Svix — a deterministic verifier: any header signature === "valid-sig"
// passes and the payload is returned parsed; anything else throws.
vi.mock("svix", () => ({
  Webhook: class MockWebhook {
    constructor(readonly secret: string) {}
    verify(payload: string, headers: Record<string, string>) {
      if (headers["svix-signature"] !== "valid-sig") {
        throw new Error("Invalid signature");
      }
      return JSON.parse(payload);
    }
  },
}));

// Firestore admin — in-memory fakes just rich enough for the webhook path.
// Captures writes so tests can assert what landed in each collection.
const { suppressionWrites, subscriberUpdates, subscriberLookup, auditWrites } = vi.hoisted(() => ({
  suppressionWrites: [] as Array<{ id: string; data: Record<string, unknown> }>,
  subscriberUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  subscriberLookup: new Map<string, string>(), // email → subscriberId
  auditWrites: [] as Array<Record<string, unknown>>,
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__SERVER_TS__" },
}));

vi.mock("../../../utils/admin", () => {
  type SubRef = { id: string };

  // Build a query object whose shape mirrors Firestore: chainable
  // `where().limit()` returning itself, terminated by `get()` (for the
  // non-tx suppression write) OR handed to tx.get(...) inside a
  // transaction (for the subscriber deactivate path).
  function makeSubscriberQuery(emailValue: string) {
    return {
      __emailFilter: emailValue,
      limit: () => makeSubscriberQuery(emailValue),
    };
  }

  function resolveSubscriberQuery(emailFilter: string) {
    const subId = subscriberLookup.get(emailFilter);
    if (!subId) return { empty: true, docs: [] };
    const ref: SubRef = { id: subId };
    return { empty: false, docs: [{ ref, id: subId }] };
  }

  return {
    COLLECTIONS: {
      EMAIL_SUPPRESSIONS: "emailSuppressions",
      NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
    },
    db: {
      collection: (name: string) => ({
        doc: (id: string) => ({
          set: (data: Record<string, unknown>) => {
            if (name === "emailSuppressions") suppressionWrites.push({ id, data });
            return Promise.resolve();
          },
        }),
        where: (_field: string, _op: string, value: string) => makeSubscriberQuery(value),
        add: (data: Record<string, unknown>) => {
          if (name === "auditLogs") auditWrites.push(data);
          return Promise.resolve({ id: "audit-1" });
        },
      }),
      runTransaction: async (fn: (tx: unknown) => unknown) => {
        const tx = {
          get: async (query: { __emailFilter?: string }) => {
            if (query.__emailFilter !== undefined) {
              return resolveSubscriberQuery(query.__emailFilter);
            }
            return { empty: true, docs: [] };
          },
          update: (ref: SubRef, patch: Record<string, unknown>) => {
            subscriberUpdates.push({ id: ref.id, patch });
          },
        };
        return fn(tx);
      },
    },
  };
});

// Function-options is pure config; the real module works fine in tests.

import { resendWebhook } from "../resend-webhook.https";

// Tiny Express-like fake just enough for req.method / req.rawBody / req.get,
// and res.status(n).send() capture. Our handler is typed as onRequest but
// after the mock it's a plain (req, res) => Promise<void>.
type FakeReq = {
  method: string;
  rawBody?: Buffer;
  get: (name: string) => string | undefined;
};
type FakeRes = {
  statusCode?: number;
  body?: unknown;
  status: (code: number) => FakeRes;
  send: (body: unknown) => void;
};

function makeReq(opts: {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): FakeReq {
  const headers = opts.headers ?? {};
  const raw = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body), "utf8");
  return {
    method: opts.method ?? "POST",
    rawBody: raw,
    get: (name: string) => headers[name.toLowerCase()] ?? headers[name],
  };
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.body = body;
    },
  };
  return res;
}

const handler = resendWebhook as unknown as (req: FakeReq, res: FakeRes) => Promise<void>;

// Fake Svix headers — svix-signature === "valid-sig" passes the mocked verify.
const validHeaders = {
  "svix-id": "msg_1",
  "svix-timestamp": "1700000000",
  "svix-signature": "valid-sig",
};

beforeEach(() => {
  suppressionWrites.length = 0;
  subscriberUpdates.length = 0;
  subscriberLookup.clear();
  auditWrites.length = 0;
  secretValueOverride = "whsec_valid";
});

describe("resendWebhook", () => {
  it("rejects non-POST with 405", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 503 when the webhook secret is still the bootstrap placeholder", async () => {
    secretValueOverride = "pending-bootstrap";
    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "email.bounced", data: { email: "x@test.com" } },
        headers: validHeaders,
      }),
      res,
    );
    expect(res.statusCode).toBe(503);
    expect(suppressionWrites).toHaveLength(0);
  });

  it("rejects requests with an invalid Svix signature (400)", async () => {
    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "email.bounced", data: { email: "x@test.com" } },
        headers: { ...validHeaders, "svix-signature": "bogus" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(suppressionWrites).toHaveLength(0);
  });

  it("on email.bounced writes a suppression row AND deactivates the subscriber", async () => {
    subscriberLookup.set("bouncer@test.com", "sub-1");

    const res = makeRes();
    await handler(
      makeReq({
        body: {
          type: "email.bounced",
          created_at: "2026-04-21T10:00:00Z",
          data: { email: "bouncer@test.com", email_id: "ev-abc" },
        },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(suppressionWrites).toHaveLength(1);
    expect(suppressionWrites[0]).toMatchObject({
      id: "bouncer@test.com",
      data: expect.objectContaining({
        email: "bouncer@test.com",
        reason: "hard_bounce",
        sourceEmailId: "ev-abc",
      }),
    });
    expect(subscriberUpdates).toHaveLength(1);
    expect(subscriberUpdates[0].patch).toMatchObject({
      isActive: false,
      // status flipped in lockstep with isActive — both the retention
      // pruner and the reconciler key on status, so leaving status as
      // "confirmed" on a bounced subscriber creates a false consent
      // record. (3c.6 fix.)
      status: "unsubscribed",
      deactivatedReason: "hard_bounce",
    });

    // Audit log row written directly (no eventBus available in Functions).
    // Makes the suppression decision queryable from the admin audit UI
    // rather than just Cloud Logging. (3c.6 fix.)
    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0]).toMatchObject({
      action: "email.bounced",
      actorId: "resend_webhook",
      resourceType: "email_address",
      resourceId: "bouncer@test.com",
      details: expect.objectContaining({
        email: "bouncer@test.com",
        sourceEmailId: "ev-abc",
      }),
    });
  });

  it("on email.complained writes a suppression row with reason=complaint", async () => {
    subscriberLookup.set("complainer@test.com", "sub-2");

    const res = makeRes();
    await handler(
      makeReq({
        body: {
          type: "email.complained",
          data: { email: "complainer@test.com", email_id: "ev-xyz" },
        },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(suppressionWrites[0].data.reason).toBe("complaint");
    expect(subscriberUpdates[0].patch.deactivatedReason).toBe("complaint");
  });

  it("on contact.updated with unsubscribed=true deactivates the subscriber", async () => {
    subscriberLookup.set("unsub@test.com", "sub-3");

    const res = makeRes();
    await handler(
      makeReq({
        body: {
          type: "contact.updated",
          data: { email: "unsub@test.com", unsubscribed: true },
        },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    // No suppression write for unsubscribe — that's a user choice, not a
    // deliverability failure. Just the Firestore deactivation.
    expect(suppressionWrites).toHaveLength(0);
    expect(subscriberUpdates[0].patch).toMatchObject({
      isActive: false,
      deactivatedReason: "resend_unsubscribe",
    });
  });

  it("on contact.updated WITHOUT unsubscribed=true is a no-op (e.g. property change)", async () => {
    subscriberLookup.set("x@test.com", "sub-4");

    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "contact.updated", data: { email: "x@test.com", unsubscribed: false } },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(subscriberUpdates).toHaveLength(0);
  });

  it("on contact.deleted deactivates the subscriber", async () => {
    subscriberLookup.set("gone@test.com", "sub-5");

    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "contact.deleted", data: { email: "gone@test.com" } },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(subscriberUpdates[0].patch.deactivatedReason).toBe("resend_contact_deleted");
  });

  it("ignores unknown event types with 200 so Resend doesn't retry them", async () => {
    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "email.opened", data: { email: "x@test.com" } },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(suppressionWrites).toHaveLength(0);
    expect(subscriberUpdates).toHaveLength(0);
  });

  it("bounces that reference a subscriber not in Firestore just write suppression (no update)", async () => {
    // Someone outside our subscriber list hard-bounces (e.g. a legacy
    // test send). We still suppress the address globally but there's
    // no newsletterSubscribers row to flip.
    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "email.bounced", data: { email: "stranger@test.com" } },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(suppressionWrites).toHaveLength(1);
    expect(subscriberUpdates).toHaveLength(0);
  });

  it("normalizes email to lowercase for both suppression + subscriber lookup", async () => {
    subscriberLookup.set("case@test.com", "sub-6");

    const res = makeRes();
    await handler(
      makeReq({
        body: { type: "email.bounced", data: { email: "Case@Test.COM" } },
        headers: validHeaders,
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(suppressionWrites[0].id).toBe("case@test.com");
    expect(subscriberUpdates).toHaveLength(1);
  });
});
