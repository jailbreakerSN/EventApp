import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// The audit service now denormalizes the acting user's displayName at
// write time (T1.1 of the admin overhaul follow-up). The mock exposes
// two distinct collections — `auditLogs` (write-only) and `users`
// (read-only doc lookup) — so tests can drive the resolver independently
// of the write path.

const mockDocRef = {
  id: "auto-generated-id",
  set: vi.fn(),
};

const mockUserGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => ({ get: mockUserGet })),
        };
      }
      return {
        doc: vi.fn(() => mockDocRef),
      };
    }),
  },
  COLLECTIONS: {
    AUDIT_LOGS: "auditLogs",
    USERS: "users",
  },
}));

// Import AFTER mocks
import { auditService, __clearActorNameCache } from "../audit.service";
import { db } from "@/config/firebase";

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  __clearActorNameCache();
  // By default the user lookup returns "not found" so existing tests
  // that don't care about denorm keep their assertions intact.
  mockUserGet.mockResolvedValue({ exists: false, data: () => undefined });
});

describe("AuditService.log", () => {
  it("writes an audit log entry to the auditLogs collection", async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    const entry = {
      action: "event.created" as const,
      actorId: "user-123",
      resourceType: "event",
      resourceId: "event-456",
      organizationId: "org-1",
      eventId: "event-456",
      details: { title: "Test Event" } as Record<string, unknown>,
      requestId: "req-1",
      timestamp: new Date().toISOString(),
    };

    await auditService.log(entry);

    expect(db.collection).toHaveBeenCalledWith("auditLogs");
    expect(mockDocRef.set).toHaveBeenCalledWith({
      id: "auto-generated-id",
      ...entry,
      // Denorm lookup returned not-found → null.
      actorDisplayName: null,
    });
  });

  it("includes the auto-generated document ID in the entry", async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    const entry = {
      action: "user.role_changed" as const,
      actorId: "admin-1",
      resourceType: "user",
      resourceId: "user-2",
      organizationId: null,
      eventId: null,
      details: {} as Record<string, unknown>,
      requestId: "req-2",
      timestamp: new Date().toISOString(),
    };

    await auditService.log(entry);

    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: "auto-generated-id" }),
    );
  });

  it("catches errors and writes to stderr without throwing", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockDocRef.set.mockRejectedValue(new Error("Firestore write failed"));

    const entry = {
      action: "event.published" as const,
      actorId: "user-789",
      resourceType: "event",
      resourceId: "event-000",
      organizationId: "org-1",
      eventId: "event-000",
      details: {} as Record<string, unknown>,
      requestId: "req-3",
      timestamp: new Date().toISOString(),
    };

    // Should NOT throw
    await expect(auditService.log(entry)).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[AuditService] Failed to write audit log"),
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Firestore write failed"));

    stderrSpy.mockRestore();
  });

  it("does not propagate Firestore errors to callers", async () => {
    mockDocRef.set.mockRejectedValue(new Error("Network timeout"));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const entry = {
      action: "organization.verified" as const,
      actorId: "admin-1",
      resourceType: "organization",
      resourceId: "org-1",
      organizationId: "org-1",
      eventId: null,
      details: {} as Record<string, unknown>,
      requestId: "req-4",
      timestamp: new Date().toISOString(),
    };

    const result = await auditService.log(entry);
    expect(result).toBeUndefined();

    stderrSpy.mockRestore();
  });
});

// ─── Actor display-name denormalization (T1.1) ──────────────────────────────

describe("AuditService.log — actorDisplayName denormalization", () => {
  const baseEntry = {
    action: "event.created" as const,
    resourceType: "event",
    resourceId: "event-1",
    organizationId: "org-1",
    eventId: "event-1",
    details: {} as Record<string, unknown>,
    requestId: "req-denorm",
    timestamp: new Date().toISOString(),
  };

  it("resolves displayName from the users collection", async () => {
    mockDocRef.set.mockResolvedValue(undefined);
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: "Alice Dupont", email: "alice@teranga.dev" }),
    });

    await auditService.log({ ...baseEntry, actorId: "user-alice" });

    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ actorDisplayName: "Alice Dupont" }),
    );
  });

  it("falls back to email when displayName is empty", async () => {
    mockDocRef.set.mockResolvedValue(undefined);
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: "  ", email: "bob@teranga.dev" }),
    });

    await auditService.log({ ...baseEntry, actorId: "user-bob" });

    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ actorDisplayName: "bob@teranga.dev" }),
    );
  });

  it("writes null actorDisplayName when the user doc does not exist", async () => {
    mockDocRef.set.mockResolvedValue(undefined);
    mockUserGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await auditService.log({ ...baseEntry, actorId: "ghost-user" });

    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ actorDisplayName: null }),
    );
  });

  it("writes null actorDisplayName for system-sentinel actors without a users lookup", async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    await auditService.log({ ...baseEntry, actorId: "system" });

    expect(mockUserGet).not.toHaveBeenCalled();
    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ actorDisplayName: null }),
    );
  });

  it("caches successful lookups for 5 minutes (second write hits the cache)", async () => {
    mockDocRef.set.mockResolvedValue(undefined);
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: "Carla Ba" }),
    });

    await auditService.log({ ...baseEntry, actorId: "user-carla" });
    await auditService.log({ ...baseEntry, actorId: "user-carla" });

    // One network read for both writes thanks to the cache.
    expect(mockUserGet).toHaveBeenCalledTimes(1);
    expect(mockDocRef.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actorDisplayName: "Carla Ba" }),
    );
    expect(mockDocRef.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actorDisplayName: "Carla Ba" }),
    );
  });

  it("does NOT cache negative hits — a user that shows up later resolves on the next write", async () => {
    mockDocRef.set.mockResolvedValue(undefined);
    mockUserGet
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ displayName: "Daouda Sow" }),
      });

    await auditService.log({ ...baseEntry, actorId: "user-daouda" });
    await auditService.log({ ...baseEntry, actorId: "user-daouda" });

    expect(mockUserGet).toHaveBeenCalledTimes(2);
    expect(mockDocRef.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actorDisplayName: null }),
    );
    expect(mockDocRef.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actorDisplayName: "Daouda Sow" }),
    );
  });

  it("falls back to null when the users lookup throws — never blocks the audit write", async () => {
    mockDocRef.set.mockResolvedValue(undefined);
    mockUserGet.mockRejectedValueOnce(new Error("firestore unavailable"));

    await auditService.log({ ...baseEntry, actorId: "user-e" });

    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ actorDisplayName: null }),
    );
  });

  it("honours an explicit actorDisplayName passed by the caller (short-circuits the lookup)", async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    await auditService.log({
      ...baseEntry,
      actorId: "user-f",
      actorDisplayName: "Fatou Sarr (backfill)",
    });

    expect(mockUserGet).not.toHaveBeenCalled();
    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ actorDisplayName: "Fatou Sarr (backfill)" }),
    );
  });
});
