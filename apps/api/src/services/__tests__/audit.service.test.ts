import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockDocRef = {
  id: "auto-generated-id",
  set: vi.fn(),
};

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockDocRef),
    })),
  },
  COLLECTIONS: {
    AUDIT_LOGS: "auditLogs",
  },
}));

// Import AFTER mocks
import { auditService } from "../audit.service";
import { db } from "@/config/firebase";

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditService.log", () => {
  it("writes an audit log entry to the auditLogs collection", async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    const entry = {
      action: "event.created" as const,
      actorId: "user-123",
      resourceType: "event" as const,
      resourceId: "event-456",
      timestamp: new Date().toISOString(),
      metadata: { title: "Test Event" },
    };

    await auditService.log(entry);

    expect(db.collection).toHaveBeenCalledWith("auditLogs");
    expect(mockDocRef.set).toHaveBeenCalledWith({
      id: "auto-generated-id",
      ...entry,
    });
  });

  it("includes the auto-generated document ID in the entry", async () => {
    mockDocRef.set.mockResolvedValue(undefined);

    const entry = {
      action: "user.role_changed" as const,
      actorId: "admin-1",
      resourceType: "user" as const,
      resourceId: "user-2",
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
      resourceType: "event" as const,
      resourceId: "event-000",
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
      resourceType: "organization" as const,
      resourceId: "org-1",
      timestamp: new Date().toISOString(),
    };

    const result = await auditService.log(entry);
    expect(result).toBeUndefined();

    stderrSpy.mockRestore();
  });
});
