/**
 * Pins Wave 10 / W10-P4 — BaseRepository.update / softDelete race
 * fix.
 *
 * Background
 * ──────────
 * The pre-W10 implementation did:
 *
 *     const doc = await docRef.get();
 *     if (!doc.exists) throw new NotFoundError(...);
 *     await docRef.update(...);
 *
 * That is a read-then-write outside a transaction. A concurrent delete
 * between the get and the update would either (a) cause Firestore to
 * raise its raw `not-found` error, or (b) succeed at writing to a
 * doc the caller intended to operate on but had been recreated by
 * another writer. Either way, the caller-facing semantics drift away
 * from "404 Not Found via NotFoundError".
 *
 * The W10-P4 refactor drops the pre-read entirely. Firestore's
 * `update()` natively rejects with `not-found` when the doc is
 * missing; we translate that provider error into our typed
 * `NotFoundError` so the caller-facing 404 stays consistent. One
 * fewer read; no race window.
 *
 * What we pin
 * ───────────
 *   1. Happy path: update on an existing doc reaches `docRef.update()`
 *      with the supplied data + an `updatedAt` stamp.
 *   2. Missing doc: Firestore raises `not-found`; the repo throws
 *      `NotFoundError(<resourceName>, <id>)`.
 *   3. Other Firestore errors propagate unchanged so callers can
 *      handle permission-denied, deadline-exceeded, etc.
 *   4. softDelete uses the same translation path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const docUpdate = vi.fn();

const docRef = {
  update: docUpdate,
  set: vi.fn(),
  get: vi.fn(),
  id: "doc-1",
};

const collectionMock = {
  doc: vi.fn(() => docRef),
};

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => collectionMock),
    getAll: vi.fn(),
    runTransaction: vi.fn(),
  },
}));

vi.mock("@/context/request-context", () => ({
  trackFirestoreReads: vi.fn(),
}));

vi.mock("@/observability/sentry", () => ({
  withSpan: <T>(_opts: unknown, cb: () => Promise<T>) => cb(),
}));

import { BaseRepository } from "@/repositories/base.repository";
import { NotFoundError } from "@/errors/app-error";

interface ThingShape {
  id: string;
  name: string;
}

describe("BaseRepository.update — W10-P4 race-free contract", () => {
  beforeEach(() => {
    docUpdate.mockReset();
  });

  it("happy path: writes data + updatedAt without a pre-read", async () => {
    docUpdate.mockResolvedValueOnce(undefined);
    const repo = new BaseRepository<ThingShape>("things", "thing");

    await repo.update("doc-1", { name: "Updated" });

    expect(docUpdate).toHaveBeenCalledTimes(1);
    const arg = docUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.name).toBe("Updated");
    expect(typeof arg.updatedAt).toBe("string");
    // Critical contract — no pre-read happens (the pre-W10 race window).
    expect(docRef.get).not.toHaveBeenCalled();
  });

  it("translates Firestore not-found (gRPC code 5) into NotFoundError", async () => {
    docUpdate.mockRejectedValueOnce(Object.assign(new Error("NOT_FOUND"), { code: 5 }));
    const repo = new BaseRepository<ThingShape>("things", "thing");

    await expect(repo.update("missing-doc", { name: "X" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("translates string `not-found` code (Firebase JS SDK) into NotFoundError", async () => {
    docUpdate.mockRejectedValueOnce(
      Object.assign(new Error("No document to update: ..."), { code: "not-found" }),
    );
    const repo = new BaseRepository<ThingShape>("things", "thing");

    await expect(repo.update("missing-doc", { name: "X" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("propagates non-not-found Firestore errors unchanged", async () => {
    const permissionDenied = Object.assign(new Error("permission denied"), {
      code: "permission-denied",
    });
    docUpdate.mockRejectedValueOnce(permissionDenied);
    const repo = new BaseRepository<ThingShape>("things", "thing");

    await expect(repo.update("doc-1", { name: "X" })).rejects.toBe(permissionDenied);
  });
});

describe("BaseRepository.softDelete — W10-P4 race-free contract", () => {
  beforeEach(() => {
    docUpdate.mockReset();
  });

  it("happy path: writes status + updatedAt without a pre-read", async () => {
    docUpdate.mockResolvedValueOnce(undefined);
    const repo = new BaseRepository<ThingShape>("things", "thing");

    await repo.softDelete("doc-1");

    expect(docUpdate).toHaveBeenCalledTimes(1);
    const arg = docUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.status).toBe("archived");
    expect(typeof arg.updatedAt).toBe("string");
    expect(docRef.get).not.toHaveBeenCalled();
  });

  it("translates Firestore not-found into NotFoundError", async () => {
    docUpdate.mockRejectedValueOnce(Object.assign(new Error("NOT_FOUND"), { code: 5 }));
    const repo = new BaseRepository<ThingShape>("things", "thing");

    await expect(repo.softDelete("missing-doc")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("BaseRepository.findMany — soft-delete default (P0.4)", () => {
  // Build a self-contained query mock that records every `where` call so we
  // can assert the soft-delete filter is/isn't injected. We bypass the
  // module-level mock because the existing `collectionMock` only stubs the
  // doc() path used by update/softDelete tests.
  function makeQueryMock(): {
    whereCalls: Array<[string, string, unknown]>;
    rebind: () => void;
  } {
    const whereCalls: Array<[string, string, unknown]> = [];
    const queryShape = {
      where: vi.fn((field: string, op: string, value: unknown) => {
        whereCalls.push([field, op, value]);
        return queryShape;
      }),
      orderBy: vi.fn(() => queryShape),
      offset: vi.fn(() => queryShape),
      limit: vi.fn(() => queryShape),
      get: vi.fn(async () => ({ docs: [], size: 0 })),
      count: vi.fn(() => ({ get: async () => ({ data: () => ({ count: 0 }) }) })),
    };

    const rebind = (): void => {
      // Rebind both the doc() collection (already stubbed for update tests)
      // and the where() collection used by findMany.
      (collectionMock as unknown as { where: typeof queryShape.where }).where =
        queryShape.where;
      (collectionMock as unknown as { orderBy: typeof queryShape.orderBy }).orderBy =
        queryShape.orderBy;
      (collectionMock as unknown as { offset: typeof queryShape.offset }).offset =
        queryShape.offset;
      (collectionMock as unknown as { limit: typeof queryShape.limit }).limit =
        queryShape.limit;
      (collectionMock as unknown as { get: typeof queryShape.get }).get = queryShape.get;
      (collectionMock as unknown as { count: typeof queryShape.count }).count = queryShape.count;
    };

    return { whereCalls, rebind };
  }

  class SoftDeleteRepo extends BaseRepository<ThingShape> {
    protected override readonly softDeleteConfig = {
      field: "status",
      tombstones: ["archived", "cancelled"] as const,
    };
    constructor() {
      super("things", "thing");
    }
  }

  class PlainRepo extends BaseRepository<ThingShape> {
    constructor() {
      super("things", "thing");
    }
  }

  it("injects a not-in tombstone filter by default when softDelete config is set", async () => {
    const { whereCalls, rebind } = makeQueryMock();
    rebind();
    await new SoftDeleteRepo().findMany([{ field: "type", op: "==", value: "event" }]);

    const tombstoneCall = whereCalls.find(([f]) => f === "status");
    expect(tombstoneCall).toBeDefined();
    expect(tombstoneCall?.[1]).toBe("not-in");
    expect(tombstoneCall?.[2]).toEqual(["archived", "cancelled"]);
  });

  it("skips the tombstone filter when caller passes includeArchived: true", async () => {
    const { whereCalls, rebind } = makeQueryMock();
    rebind();
    await new SoftDeleteRepo().findMany(
      [{ field: "type", op: "==", value: "event" }],
      undefined,
      { includeArchived: true },
    );

    expect(whereCalls.find(([f]) => f === "status")).toBeUndefined();
  });

  it("never injects when softDelete config is not set", async () => {
    const { whereCalls, rebind } = makeQueryMock();
    rebind();
    await new PlainRepo().findMany([{ field: "type", op: "==", value: "event" }]);

    expect(whereCalls.find(([f]) => f === "status")).toBeUndefined();
  });
});
