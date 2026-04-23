import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
// Minimal in-memory Firestore double. The service writes documents keyed
// by `${scope}:${hashedIdentifier}:${windowStartBucket}`; we let the
// transaction shim route both `tx.get` and `tx.set`/`tx.update` through
// the same ref object so doc lookups are trivial.

type BucketDoc = {
  id?: string;
  scope?: string;
  identifier?: string;
  count?: number;
  limit?: number;
  windowSec?: number;
  windowStartAt?: string;
  expiresAt?: string;
  createdAt?: string;
};

const bucketStore = new Map<string, BucketDoc>();

// Spy counters — let tests assert the helper never touched Firestore
// when it's supposed to short-circuit.
let getCallCount = 0;
let txCallCount = 0;

function makeRef(id: string) {
  return {
    __id: id,
    get: async () => {
      getCallCount += 1;
      return {
        exists: bucketStore.has(id),
        data: () => bucketStore.get(id),
      };
    },
    set: (payload: BucketDoc) => {
      bucketStore.set(id, payload);
    },
    update: (patch: Partial<BucketDoc>) => {
      const existing = bucketStore.get(id) ?? {};
      bucketStore.set(id, { ...existing, ...patch });
    },
  };
}

// Toggle to force `runTransaction` to throw, simulating a Firestore
// outage. Tests that care about the fail-open path flip this on.
let forceTxError: Error | null = null;

// Global mutex so concurrent `runTransaction` calls serialize, matching
// Firestore's real OCC semantics: two transactions touching the same doc
// are effectively serialized via retries. We don't simulate retries
// explicitly — we just run the callbacks back-to-back so each observes
// the prior's writes.
let txChain: Promise<unknown> = Promise.resolve();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: (_name: string) => ({
      doc: (id: string) => makeRef(id),
    }),
    runTransaction: async (cb: (tx: unknown) => unknown) => {
      txCallCount += 1;
      if (forceTxError) throw forceTxError;
      // Serialize against prior transactions so concurrent callers
      // observe each other's writes — a faithful stand-in for OCC
      // retries. Without this, Promise.all across N callers would let
      // every callback see the same stale snapshot and the rate-limit
      // correctness guarantee collapses.
      const prev = txChain;
      let resolveRun!: () => void;
      txChain = new Promise<void>((r) => (resolveRun = r));
      await prev.catch(() => {
        /* ignore errors from prior txns so we don't starve the chain */
      });
      try {
        const tx = {
          get: (ref: { get: () => unknown }) => ref.get(),
          set: (ref: { set: (data: BucketDoc) => void }, data: BucketDoc) =>
            ref.set(data),
          update: (ref: { update: (patch: Partial<BucketDoc>) => void }, patch: Partial<BucketDoc>) =>
            ref.update(patch),
        };
        return await cb(tx);
      } finally {
        resolveRun();
      }
    },
  },
  COLLECTIONS: { RATE_LIMIT_BUCKETS: "rateLimitBuckets" },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Capture structured warn logs emitted via process.stderr.write so the
// fail-open test can assert the warning was logged.
let stderrChunks: string[];
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Import under test AFTER mocks so module resolution picks up the stubs.
import { rateLimit } from "../rate-limit.service";

// ─── Fixtures ──────────────────────────────────────────────────────────────

beforeEach(() => {
  bucketStore.clear();
  getCallCount = 0;
  txCallCount = 0;
  forceTxError = null;
  stderrChunks = [];
  // Reset the per-test tx serialization chain so a prior test's
  // unresolved txn can't bleed into the next.
  txChain = Promise.resolve();
  // Intercept structured warn lines without breaking other stderr writes.
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    stderrChunks.push(String(chunk));
    return originalStderrWrite(chunk as string | Uint8Array, ...(rest as []));
  }) as typeof process.stderr.write;
  delete process.env.RATE_LIMIT_DISABLED;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
  delete process.env.RATE_LIMIT_DISABLED;
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("rateLimit()", () => {
  it("allows the first hit and writes a new bucket doc with count=1", async () => {
    const result = await rateLimit({
      scope: "test-send:self",
      identifier: "uid-alpha",
      limit: 5,
      windowSec: 3600,
    });

    expect(result).toMatchObject({ allowed: true, count: 1, limit: 5 });
    expect(result.retryAfterSec).toBeUndefined();
    expect(bucketStore.size).toBe(1);
    const [doc] = Array.from(bucketStore.values());
    expect(doc).toMatchObject({
      scope: "test-send:self",
      count: 1,
      limit: 5,
      windowSec: 3600,
    });
    // The raw identifier is NEVER persisted. Identifier field is the
    // 16-char sha256 prefix.
    expect(doc?.identifier).not.toBe("uid-alpha");
    expect(doc?.identifier).toMatch(/^[0-9a-f]{16}$/);
  });

  it("increments count on subsequent hits within the same window", async () => {
    const opts = {
      scope: "test-send:self",
      identifier: "uid-beta",
      limit: 5,
      windowSec: 3600,
    };

    for (let i = 1; i <= 5; i++) {
      const result = await rateLimit(opts);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i);
    }

    expect(bucketStore.size).toBe(1);
  });

  it("denies the (N+1)th hit and populates retryAfterSec", async () => {
    const opts = {
      scope: "test-send:self",
      identifier: "uid-gamma",
      limit: 3,
      windowSec: 3600,
    };

    for (let i = 0; i < 3; i++) {
      const ok = await rateLimit(opts);
      expect(ok.allowed).toBe(true);
    }

    const denied = await rateLimit(opts);
    expect(denied.allowed).toBe(false);
    expect(denied.count).toBe(3);
    expect(denied.limit).toBe(3);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    // The hour window means retryAfter must be ≤ 3600 seconds.
    expect(denied.retryAfterSec).toBeLessThanOrEqual(3600);
  });

  it("does not re-increment once a caller is over the limit", async () => {
    // Guard against the obvious footgun: if a throttled caller keeps
    // hammering the endpoint, each denied attempt should NOT cost us one
    // Firestore write. The doc stays at count=limit.
    const opts = {
      scope: "test-send:self",
      identifier: "uid-delta",
      limit: 2,
      windowSec: 3600,
    };
    await rateLimit(opts);
    await rateLimit(opts);
    await rateLimit(opts); // denied
    await rateLimit(opts); // still denied

    const [doc] = Array.from(bucketStore.values());
    expect(doc?.count).toBe(2);
  });

  it("starts a fresh bucket after the window rolls", async () => {
    const originalNow = Date.now;
    try {
      // Freeze time at a known window boundary. Window=60s means buckets
      // align on every 60-second epoch mark; 1_700_000_000 ≡ 0 mod 60.
      const t0 = 1_700_000_000 * 1000;
      Date.now = () => t0 + 5_000; // 5s into the first window

      const first = await rateLimit({
        scope: "scope:window",
        identifier: "uid-window",
        limit: 1,
        windowSec: 60,
      });
      expect(first.allowed).toBe(true);

      // Advance past the first window (60s later).
      Date.now = () => t0 + 65_000;

      const second = await rateLimit({
        scope: "scope:window",
        identifier: "uid-window",
        limit: 1,
        windowSec: 60,
      });
      expect(second.allowed).toBe(true);
      expect(second.count).toBe(1);
      // Two distinct docs — one per window.
      expect(bucketStore.size).toBe(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("RATE_LIMIT_DISABLED=true short-circuits before any Firestore call", async () => {
    process.env.RATE_LIMIT_DISABLED = "true";

    const result = await rateLimit({
      scope: "test-send:self",
      identifier: "uid-epsilon",
      limit: 5,
      windowSec: 3600,
    });

    expect(result).toEqual({ allowed: true, count: 0, limit: 5 });
    expect(txCallCount).toBe(0);
    expect(getCallCount).toBe(0);
    expect(bucketStore.size).toBe(0);
  });

  it("fails open on Firestore error and logs a structured warn line", async () => {
    forceTxError = new Error("Firestore is on fire");

    const result = await rateLimit({
      scope: "test-send:self",
      identifier: "uid-zeta",
      limit: 5,
      windowSec: 3600,
    });

    // Availability over enforcement: the caller must be allowed through
    // so a throttling outage doesn't become an auth/UX outage.
    expect(result).toEqual({ allowed: true, count: 0, limit: 5 });

    // A structured warn line landed on stderr so SRE dashboards can see
    // the degradation. The raw identifier MUST NOT appear — only the
    // sha256 prefix.
    const joined = stderrChunks.join("");
    expect(joined).toContain("rate_limit.firestore_error");
    expect(joined).toContain("Firestore is on fire");
    expect(joined).toContain("test-request-id");
    expect(joined).not.toContain("uid-zeta");
  });

  it("serializes concurrent callers so only `limit` requests succeed", async () => {
    // Transactional correctness: two concurrent calls at the limit must
    // not both observe `count < limit` and both conclude "allowed". The
    // mock `runTransaction` shim here runs callbacks sequentially (one
    // awaited after another), which matches Firestore's real semantics
    // — concurrent transactions on the same doc are serialized with
    // OCC retries.
    const opts = {
      scope: "test-send:self",
      identifier: "uid-eta",
      limit: 3,
      windowSec: 3600,
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => rateLimit(opts)),
    );

    const allowed = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);
    expect(allowed).toHaveLength(3);
    expect(denied).toHaveLength(2);

    // Bucket doc state reflects exactly `limit` successful increments.
    const [doc] = Array.from(bucketStore.values());
    expect(doc?.count).toBe(3);
  });

  it("namespaces buckets by scope so different scopes don't share budget", async () => {
    // Same user, two scopes, shared limit. Each scope gets its own
    // budget — a noisy `test-send:self` consumer must not exhaust the
    // `fcm.register` budget.
    const idOptsA = {
      scope: "test-send:self" as const,
      identifier: "uid-shared",
      limit: 1,
      windowSec: 3600,
    };
    const idOptsB = {
      scope: "fcm.register" as const,
      identifier: "uid-shared",
      limit: 1,
      windowSec: 3600,
    };

    expect((await rateLimit(idOptsA)).allowed).toBe(true);
    expect((await rateLimit(idOptsB)).allowed).toBe(true);
    // Each scope has now hit its budget on this single user.
    expect((await rateLimit(idOptsA)).allowed).toBe(false);
    expect((await rateLimit(idOptsB)).allowed).toBe(false);

    expect(bucketStore.size).toBe(2);
  });
});
