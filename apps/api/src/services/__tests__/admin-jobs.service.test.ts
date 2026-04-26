import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// The service under test composes five external things: the registry
// (real — small enough to keep live), the runs repository, the locks
// collection (Firestore transaction), the rate limiter, the audit log
// (add), and the domain event bus. We mock every boundary so tests
// control each branch without booting Firestore.

const hoisted = vi.hoisted(() => ({
  mockRepoCreate: vi.fn().mockResolvedValue(undefined),
  mockRepoUpdate: vi.fn().mockResolvedValue(undefined),
  mockRepoFindById: vi.fn(),
  mockRepoList: vi.fn(),
  mockLockGet: vi.fn(),
  mockLockSet: vi.fn(),
  mockLockDelete: vi.fn().mockResolvedValue(undefined),
  mockAuditAdd: vi.fn().mockResolvedValue({ id: "audit-row" }),
  mockRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  mockBusEmit: vi.fn(),
  // Auto-generated run id so the test can assert it appears on every write.
  mockDocId: vi.fn(() => "run-id-fixed"),
}));

const {
  mockRepoCreate,
  mockRepoUpdate,
  mockRepoFindById,
  mockRepoList,
  mockLockGet,
  mockLockSet,
  mockLockDelete,
  mockAuditAdd,
  mockRateLimit,
  mockBusEmit,
} = hoisted;

vi.mock("@/repositories/admin-job-runs.repository", () => ({
  adminJobRunsRepository: {
    create: hoisted.mockRepoCreate,
    update: hoisted.mockRepoUpdate,
    findById: hoisted.mockRepoFindById,
    list: hoisted.mockRepoList,
  },
}));

vi.mock("@/services/rate-limit.service", () => ({
  rateLimit: hoisted.mockRateLimit,
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: hoisted.mockBusEmit },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "req-test-1",
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id?: string) => {
        if (name === "adminJobLocks") {
          return {
            get: hoisted.mockLockGet,
            set: hoisted.mockLockSet,
            delete: hoisted.mockLockDelete,
            id: id ?? "locked",
          };
        }
        if (name === "adminJobRuns") {
          // `.doc()` (no id) returns a ref whose `.id` is the auto id.
          return { id: id ?? hoisted.mockDocId() };
        }
        if (name === "users") {
          return { get: vi.fn().mockResolvedValue({ exists: false }) };
        }
        return { id: id ?? "x" };
      }),
      add: name === "auditLogs" ? hoisted.mockAuditAdd : vi.fn(),
    })),
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (data: unknown) => unknown }, data: unknown) => ref.set(data),
      };
      return cb(tx);
    }),
  },
  COLLECTIONS: {
    USERS: "users",
    AUDIT_LOGS: "auditLogs",
    ADMIN_JOB_RUNS: "adminJobRuns",
    ADMIN_JOB_LOCKS: "adminJobLocks",
    INVITES: "invites",
  },
}));

vi.mock("@/config/index", () => ({
  config: { NODE_ENV: "test" },
}));

// Import AFTER mocks
import { adminJobsService } from "../admin-jobs.service";

beforeEach(() => {
  vi.clearAllMocks();
  mockRepoCreate.mockResolvedValue(undefined);
  mockRepoUpdate.mockResolvedValue(undefined);
  mockLockDelete.mockResolvedValue(undefined);
  mockRateLimit.mockResolvedValue({ allowed: true });
  // No existing lock by default.
  mockLockGet.mockResolvedValue({ exists: false });
  // findById returns the final row shape a terminal run would have.
  // Individual tests override this.
});

// ─── Listing ───────────────────────────────────────────────────────────────

describe("AdminJobsService.listRegisteredJobs", () => {
  it("returns the registered handlers' descriptors for a super_admin", () => {
    const admin = buildSuperAdmin();
    const jobs = adminJobsService.listRegisteredJobs(admin);

    const keys = jobs.map((j) => j.jobKey).sort();
    // Five handlers are registered today — ping + prune-expired-invites
    // + Sprint-3 T4.3 backup/restore pair + P1-21 expire-stale-payments.
    // Pinning the exact list is deliberate: adding a handler MUST be a
    // visible diff so the review can decide whether the new job needs
    // extra tests / access-control treatment.
    expect(keys).toEqual([
      "expire-stale-payments",
      "firestore-backup",
      "firestore-restore",
      "ping",
      "prune-expired-invites",
    ]);
    for (const j of jobs) {
      expect(j.titleFr).toBeTruthy();
      expect(j.titleEn).toBeTruthy();
      expect(typeof j.hasInput).toBe("boolean");
    }
  });

  it("rejects non-super_admin callers", () => {
    const organizer = buildAuthUser({ roles: ["organizer"] });
    expect(() => adminJobsService.listRegisteredJobs(organizer)).toThrow(/platform:manage/i);
  });
});

// ─── Triggering ────────────────────────────────────────────────────────────

describe("AdminJobsService.runJob", () => {
  const admin = buildSuperAdmin();

  function stubFinalRun(patch: Partial<Record<string, unknown>> = {}) {
    mockRepoFindById.mockResolvedValueOnce({
      id: "run-id-fixed",
      jobKey: "ping",
      status: "succeeded",
      triggeredBy: admin.uid,
      triggeredByDisplayName: "Test Admin",
      triggeredByRole: "super_admin",
      input: {},
      triggeredAt: expect.any(String),
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      durationMs: expect.any(Number),
      output: "pong",
      error: null,
      requestId: "req-test-1",
      ...patch,
    });
  }

  it("acquires a lock, writes run rows, audits, emits events, returns the final row", async () => {
    stubFinalRun();

    const run = await adminJobsService.runJob(admin, "ping", undefined, "Test Admin");

    expect(run.status).toBe("succeeded");
    expect(run.jobKey).toBe("ping");
    // Two audit rows — one at trigger, one at completion.
    expect(mockAuditAdd).toHaveBeenCalledTimes(2);
    expect(mockAuditAdd).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: "admin.job_triggered" }),
    );
    expect(mockAuditAdd).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: "admin.job_completed" }),
    );
    // Two event-bus emissions, mirroring the audit.
    expect(mockBusEmit).toHaveBeenCalledWith(
      "admin.job_triggered",
      expect.objectContaining({ jobKey: "ping" }),
    );
    expect(mockBusEmit).toHaveBeenCalledWith(
      "admin.job_completed",
      expect.objectContaining({ jobKey: "ping", status: "succeeded" }),
    );
    // Lock is released.
    expect(mockLockDelete).toHaveBeenCalled();
    // Repo write sequence: create (queued) → update (running) → update (terminal).
    expect(mockRepoCreate).toHaveBeenCalledTimes(1);
    expect(mockRepoCreate.mock.calls[0]?.[0]).toMatchObject({ status: "queued" });
    expect(mockRepoUpdate).toHaveBeenCalledTimes(2);
    expect(mockRepoUpdate.mock.calls[0]?.[1]).toMatchObject({ status: "running" });
    expect(mockRepoUpdate.mock.calls[1]?.[1]).toMatchObject({ status: "succeeded" });
  });

  it("rejects unknown jobKey with ADMIN_JOB_NOT_FOUND (404)", async () => {
    await expect(
      adminJobsService.runJob(admin, "nonexistent-job", undefined, null),
    ).rejects.toMatchObject({
      code: "ADMIN_JOB_NOT_FOUND",
      statusCode: 404,
    });
    // No lock, no run row, no audit.
    expect(mockLockSet).not.toHaveBeenCalled();
    expect(mockRepoCreate).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  it("rejects malformed input with ADMIN_JOB_INVALID_INPUT (400) + Zod details", async () => {
    await expect(
      // ping accepts { message?: string (≤200) } — a number will fail
      adminJobsService.runJob(admin, "ping", { message: 42 }, null),
    ).rejects.toMatchObject({
      code: "ADMIN_JOB_INVALID_INPUT",
      statusCode: 400,
    });
    expect(mockLockSet).not.toHaveBeenCalled();
    expect(mockRepoCreate).not.toHaveBeenCalled();
  });

  it("rejects when a non-stale single-flight lock is held (409)", async () => {
    // Simulate a fresh lock held by another admin.
    mockLockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        jobKey: "ping",
        heldBy: "other-admin",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    await expect(adminJobsService.runJob(admin, "ping", undefined, null)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
      details: expect.objectContaining({ reason: "admin_job_already_running" }),
    });
    expect(mockRepoCreate).not.toHaveBeenCalled();
  });

  it("reclaims a stale lock (expiresAt in the past) and proceeds", async () => {
    mockLockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        jobKey: "ping",
        heldBy: "crashed-admin",
        // 10 minutes ago — past the 5-minute max run.
        expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    });
    stubFinalRun();

    const run = await adminJobsService.runJob(admin, "ping", undefined, null);

    // Proceeded to succeeded — the stale lock was overwritten.
    expect(run.status).toBe("succeeded");
    expect(mockLockSet).toHaveBeenCalled();
  });

  it("rejects when the per-admin rate limit trips (no lock, no run row)", async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 42 });

    await expect(adminJobsService.runJob(admin, "ping", undefined, null)).rejects.toThrow(
      /Quota.*5\/min/i,
    );

    expect(mockLockGet).not.toHaveBeenCalled();
    expect(mockRepoCreate).not.toHaveBeenCalled();
  });

  it("marks the run `failed` with HANDLER_ERROR when the handler throws", async () => {
    // Force an invite scan to throw by having Firestore reject the write.
    // We use the `prune-expired-invites` handler which calls batch.commit();
    // simulate via a spied global db.collection that returns a query
    // whose `.get()` rejects. Easier path: stub the registry handler.
    // For this test, we validate the failure path by queueing a ping
    // with a signal that's already aborted — the handler throws.
    stubFinalRun({
      status: "failed",
      output: null,
      error: { code: "HANDLER_ERROR", message: "boom", stack: null },
    });
    // Monkey-patch the handler registry's ping.run to throw.
    const registry = await import("@/jobs/registry");
    const ping = registry.getHandler("ping")!;
    const originalRun = ping.run;
    ping.run = async () => {
      throw new Error("boom");
    };

    try {
      const run = await adminJobsService.runJob(admin, "ping", undefined, null);
      expect(run.status).toBe("failed");
      expect(mockRepoUpdate).toHaveBeenCalledWith(
        "run-id-fixed",
        expect.objectContaining({
          status: "failed",
          error: expect.objectContaining({ code: "HANDLER_ERROR", message: "boom" }),
        }),
      );
      // Lock still released on failure.
      expect(mockLockDelete).toHaveBeenCalled();
      // Both audit rows still fire.
      expect(mockAuditAdd).toHaveBeenCalledTimes(2);
    } finally {
      ping.run = originalRun;
    }
  });

  it("rejects non-super_admin callers before any Firestore write", async () => {
    const organizer = buildAuthUser({ roles: ["organizer"] });
    await expect(adminJobsService.runJob(organizer, "ping", undefined, null)).rejects.toThrow(
      /platform:manage/i,
    );

    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockLockGet).not.toHaveBeenCalled();
    expect(mockRepoCreate).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });
});

// ─── Listing runs ──────────────────────────────────────────────────────────

describe("AdminJobsService.listRuns + getRun", () => {
  it("delegates listRuns to the repository", async () => {
    const admin = buildSuperAdmin();
    mockRepoList.mockResolvedValueOnce({
      data: [{ id: "r-1" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const res = await adminJobsService.listRuns(admin, {
      page: 1,
      limit: 20,
    });
    expect(res.data).toHaveLength(1);
    expect(mockRepoList).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it("throws NotFoundError when getRun can't find the doc", async () => {
    const admin = buildSuperAdmin();
    mockRepoFindById.mockResolvedValueOnce(null);
    await expect(adminJobsService.getRun(admin, "ghost")).rejects.toThrow();
  });
});
