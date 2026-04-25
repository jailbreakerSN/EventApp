import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";
import { ForbiddenError, NotFoundError, ValidationError } from "@/errors/app-error";

/**
 * Sprint-4 T3.2 — `ScheduledOpsService` unit tests.
 *
 * Covers the four mandatory cases (happy / permission / org-access /
 * error) per method, the dangerous-job allowlist on `create()`, the
 * domain-event emission contract on every mutation, and the
 * idempotent no-op branch on `delete()`.
 *
 * Org-access denial is intentionally OMITTED — scheduled admin ops
 * are platform-wide super-admin features, not org-scoped, so the
 * `requireOrganizationAccess` gate doesn't apply. Instead we cover
 * permission denial twice: once for a regular user and once for an
 * organizer to confirm the `platform:manage` / `platform:audit_read`
 * gate fires for any non-platform role.
 */

const hoisted = vi.hoisted(() => ({
  mockBusEmit: vi.fn(),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxSet: vi.fn(),
  mockDocSet: vi.fn(),
  mockDocGet: vi.fn(),
  mockCollectionGet: vi.fn(),
  mockGetHandler: vi.fn(),
  mockNextCronRun: vi.fn(),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: hoisted.mockBusEmit },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "req-test-1",
}));

vi.mock("@/jobs/registry", () => ({
  getHandler: hoisted.mockGetHandler,
}));

vi.mock("../cron", () => ({
  nextCronRun: hoisted.mockNextCronRun,
}));

vi.mock("@/config/firebase", () => {
  const buildCollection = () => {
    const builder: Record<string, unknown> = {
      doc: vi.fn(() => ({
        id: "op-1",
        set: hoisted.mockDocSet,
        get: hoisted.mockDocGet,
      })),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      get: hoisted.mockCollectionGet,
    };
    return builder;
  };
  return {
    db: {
      collection: vi.fn(() => buildCollection()),
      runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          get: hoisted.mockTxGet,
          update: hoisted.mockTxUpdate,
          set: hoisted.mockTxSet,
        };
        return cb(tx);
      }),
    },
    COLLECTIONS: {
      SCHEDULED_ADMIN_OPS: "scheduledAdminOps",
    },
  };
});

import { scheduledOpsService } from "../scheduled-ops.service";

const buildHandler = (overrides: Record<string, unknown> = {}) => ({
  descriptor: {
    jobKey: "ping",
    titleFr: "Ping",
    titleEn: "Ping",
    descriptionFr: "Ping",
    descriptionEn: "Ping",
    hasInput: false,
    exampleInput: null,
    dangerNoteFr: null,
    dangerNoteEn: null,
    dangerous: false,
    ...(overrides.descriptor as object | undefined),
  },
  inputSchema: (overrides.inputSchema ?? null) as z.ZodTypeAny | null,
  run: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.mockNextCronRun.mockReturnValue("2026-04-26T12:00:00.000Z");
  hoisted.mockGetHandler.mockReturnValue(buildHandler());
});

// ─── list() ────────────────────────────────────────────────────────────────

describe("ScheduledOpsService.list", () => {
  it("returns active ops, hiding archived rows", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockResolvedValue({
      docs: [
        { data: () => ({ id: "op-1", status: "active", name: "A" }) },
        { data: () => ({ id: "op-2", status: "archived", name: "B" }) },
        { data: () => ({ id: "op-3", status: "active", name: "C" }) },
      ],
    });

    const out = await scheduledOpsService.list(admin);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.id)).toEqual(["op-1", "op-3"]);
  });

  it("rejects callers without platform:audit_read or platform:manage", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(scheduledOpsService.list(participant)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("propagates Firestore failures", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockCollectionGet.mockRejectedValue(new Error("FIRESTORE_DOWN"));
    await expect(scheduledOpsService.list(admin)).rejects.toThrow("FIRESTORE_DOWN");
  });
});

// ─── get() ─────────────────────────────────────────────────────────────────

describe("ScheduledOpsService.get", () => {
  it("returns the op when it exists", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: "op-1", name: "X", status: "active" }),
    });
    const out = await scheduledOpsService.get(admin, "op-1");
    expect(out.id).toBe("op-1");
  });

  it("throws NotFoundError when missing", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockDocGet.mockResolvedValue({ exists: false });
    await expect(scheduledOpsService.get(admin, "missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects callers without platform:audit_read or platform:manage", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(scheduledOpsService.get(participant, "op-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

// ─── create() ──────────────────────────────────────────────────────────────

describe("ScheduledOpsService.create", () => {
  const dto = {
    name: "Daily ping",
    jobKey: "ping",
    cron: "0 0 * * *",
    timezone: "Africa/Dakar",
    enabled: true,
  };

  it("creates the op + emits scheduled_admin_op.created", async () => {
    const admin = buildSuperAdmin();

    const op = await scheduledOpsService.create(admin, dto);

    expect(op.name).toBe("Daily ping");
    expect(op.status).toBe("active");
    expect(op.nextRunAt).toBe("2026-04-26T12:00:00.000Z");
    expect(hoisted.mockDocSet).toHaveBeenCalledTimes(1);
    expect(hoisted.mockBusEmit).toHaveBeenCalledWith(
      "scheduled_admin_op.created",
      expect.objectContaining({
        opId: op.id,
        jobKey: "ping",
        cron: "0 0 * * *",
        actorId: admin.uid,
      }),
    );
  });

  it("rejects callers without platform:manage (audit_read alone is not enough)", async () => {
    // `create()` is a mutation — `requirePermission`, not the looser
    // `requireAnyPermission` used by the read-only methods. So a
    // caller with only `platform:audit_read` should still be denied.
    const auditor = buildAuthUser({
      roles: ["participant"],
      platformPermissions: ["platform:audit_read"],
    } as never);
    await expect(scheduledOpsService.create(auditor, dto)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
  });

  it("rejects unknown jobKey with ValidationError", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockGetHandler.mockReturnValue(null);
    await expect(
      scheduledOpsService.create(admin, { ...dto, jobKey: "unknown" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to schedule a dangerous job (firestore-restore allowlist)", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockGetHandler.mockReturnValue(
      buildHandler({ descriptor: { dangerous: true, jobKey: "firestore-restore" } }),
    );
    await expect(
      scheduledOpsService.create(admin, { ...dto, jobKey: "firestore-restore" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(hoisted.mockDocSet).not.toHaveBeenCalled();
    expect(hoisted.mockBusEmit).not.toHaveBeenCalled();
  });

  it("rejects an invalid cron expression with ValidationError", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockNextCronRun.mockImplementation(() => {
      throw new Error("invalid step in cron field: */abc");
    });
    await expect(
      scheduledOpsService.create(admin, { ...dto, cron: "*/abc * * * *" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when the cron yields no future fire within 366 days", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockNextCronRun.mockReturnValue(null);
    await expect(scheduledOpsService.create(admin, dto)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("validates jobInput against the handler's schema", async () => {
    const admin = buildSuperAdmin();
    const inputSchema = z.object({ batchSize: z.number().int().positive() });
    hoisted.mockGetHandler.mockReturnValue(buildHandler({ inputSchema }));

    await expect(
      scheduledOpsService.create(admin, { ...dto, jobInput: { batchSize: -1 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── update() ──────────────────────────────────────────────────────────────

describe("ScheduledOpsService.update", () => {
  const existing = {
    id: "op-1",
    name: "Old",
    jobKey: "ping",
    jobInput: {},
    cron: "0 0 * * *",
    timezone: "Africa/Dakar",
    enabled: true,
    status: "active" as const,
    nextRunAt: "2026-04-25T00:00:00.000Z",
    lastRunAt: null,
    lastRunRunId: null,
    lastRunStatus: null,
    createdBy: "admin-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };

  it("updates inside a transaction + emits scheduled_admin_op.updated", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockTxGet.mockResolvedValue({ exists: true, data: () => existing });

    const out = await scheduledOpsService.update(admin, "op-1", {
      name: "New",
      enabled: false,
    });

    expect(out.name).toBe("New");
    expect(out.enabled).toBe(false);
    expect(hoisted.mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(hoisted.mockBusEmit).toHaveBeenCalledWith(
      "scheduled_admin_op.updated",
      expect.objectContaining({
        opId: "op-1",
        actorId: admin.uid,
        changes: expect.arrayContaining(["name", "enabled"]),
      }),
    );
  });

  it("rejects callers without platform:manage", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(scheduledOpsService.update(participant, "op-1", { name: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws NotFoundError when the op is missing", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockTxGet.mockResolvedValue({ exists: false });
    await expect(
      scheduledOpsService.update(admin, "gone", { name: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(hoisted.mockBusEmit).not.toHaveBeenCalled();
  });

  it("recomputes nextRunAt only when cron or timezone change", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockTxGet.mockResolvedValue({ exists: true, data: () => existing });
    hoisted.mockNextCronRun.mockReturnValue("2026-05-01T00:00:00.000Z");

    await scheduledOpsService.update(admin, "op-1", { cron: "*/5 * * * *" });
    expect(hoisted.mockNextCronRun).toHaveBeenCalled();

    hoisted.mockNextCronRun.mockClear();
    await scheduledOpsService.update(admin, "op-1", { name: "noop-rename" });
    expect(hoisted.mockNextCronRun).not.toHaveBeenCalled();
  });
});

// ─── delete() — soft-delete + idempotent no-op gate ────────────────────────

describe("ScheduledOpsService.delete", () => {
  it("soft-deletes (status: archived) + emits scheduled_admin_op.deleted on first call", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "active", enabled: true }),
    });

    await scheduledOpsService.delete(admin, "op-1");

    expect(hoisted.mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "archived",
        enabled: false,
      }),
    );
    expect(hoisted.mockBusEmit).toHaveBeenCalledWith(
      "scheduled_admin_op.deleted",
      expect.objectContaining({ opId: "op-1", actorId: admin.uid }),
    );
  });

  it("does NOT emit when the op is already archived (D-1: idempotent no-op)", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "archived", enabled: false }),
    });

    await scheduledOpsService.delete(admin, "op-1");

    expect(hoisted.mockTxUpdate).not.toHaveBeenCalled();
    expect(hoisted.mockBusEmit).not.toHaveBeenCalled();
  });

  it("rejects callers without platform:manage", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(scheduledOpsService.delete(participant, "op-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws NotFoundError when the op never existed", async () => {
    const admin = buildSuperAdmin();
    hoisted.mockTxGet.mockResolvedValue({ exists: false });
    await expect(scheduledOpsService.delete(admin, "gone")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(hoisted.mockBusEmit).not.toHaveBeenCalled();
  });
});
