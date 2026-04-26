import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, NotFoundError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";
import type { Incident } from "@teranga/shared-types";

// ─── Incident service — create/update/resolve contract ────────────────────
//
// Phase O8. Tests pin: per-row event emission, status-driven
// resolved event with durationMs, permission denial, cross-org
// rejection, NotFound on unknown id.

interface DocStub {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

const hoisted = vi.hoisted(() => ({
  storedDoc: null as DocStub | null,
  setMock: vi.fn(),
  emitMock: vi.fn(),
  newDocId: "inc-new",
}));

const setMock = hoisted.setMock;
const emitMock = hoisted.emitMock;
function setStoredDoc(value: typeof hoisted.storedDoc): void {
  hoisted.storedDoc = value;
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn((id?: string) => ({
        id: id ?? hoisted.newDocId,
        get: async () => hoisted.storedDoc ?? { exists: false, data: () => undefined },
        set: hoisted.setMock,
      })),
    })),
    // `update()` runs inside a transaction. The mock plays the
    // callback against a tx whose `get` returns the stored doc and
    // whose `set` records the next snapshot via the same `setMock`.
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: async () => hoisted.storedDoc ?? { exists: false, data: () => undefined },
        set: (_ref: unknown, value: unknown) => {
          hoisted.setMock(value);
        },
      };
      return cb(tx);
    }),
  },
  COLLECTIONS: { INCIDENTS: "incidents" },
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findByIdOrThrow: vi.fn(async (id: string) => ({
      id,
      organizationId: "org-1",
      status: "published",
    })),
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: hoisted.emitMock },
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: () => ({ requestId: "test-request-id" }),
  getRequestId: () => "test-request-id",
  trackFirestoreReads: vi.fn(),
}));

import { incidentService } from "../incident.service";

beforeEach(() => {
  vi.clearAllMocks();
  setStoredDoc(null);
});

describe("incidentService.create", () => {
  it("creates an open incident, persists it, emits incident.created", async () => {
    const user = buildAuthUser({
      uid: "u-staff",
      roles: ["staff"],
      organizationId: "org-1",
    });

    const result = await incidentService.create(
      "evt-1",
      {
        kind: "medical",
        severity: "high",
        description: "Participant en malaise zone B",
        location: "Hall B — entrée 2",
      },
      user,
    );

    expect(result.eventId).toBe("evt-1");
    expect(result.organizationId).toBe("org-1");
    expect(result.status).toBe("open");
    expect(result.kind).toBe("medical");
    expect(result.severity).toBe("high");
    expect(result.reportedBy).toBe("u-staff");
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      "incident.created",
      expect.objectContaining({
        eventId: "evt-1",
        organizationId: "org-1",
        kind: "medical",
        severity: "high",
      }),
    );
  });

  it("rejects callers without checkin:scan", async () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    await expect(
      incidentService.create(
        "evt-1",
        { kind: "other", severity: "low", description: "x" },
        participant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("incidentService.update — resolved transitions", () => {
  it("emits incident.resolved with durationMs when status transitions to resolved", async () => {
    // createdAt must be reliably in the past relative to wall-clock so
    // `resolvedMs - createdMs` is positive. We use 2025 to keep the
    // assertion stable regardless of when CI runs.
    const createdAt = "2025-04-01T10:00:00.000Z";
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "inc-1",
          eventId: "evt-1",
          organizationId: "org-1",
          kind: "logistics",
          severity: "medium",
          status: "in_progress",
          description: "Queue overflow",
          location: null,
          reportedBy: "u-staff",
          assignedTo: "u-org",
          resolutionNote: null,
          createdAt,
          updatedAt: createdAt,
          resolvedAt: null,
        }) satisfies Incident,
    });

    const user = buildOrganizerUser("org-1");
    const result = await incidentService.update(
      "inc-1",
      { status: "resolved", resolutionNote: "Renforts envoyés" },
      user,
    );

    expect(result.status).toBe("resolved");
    expect(result.resolvedAt).not.toBeNull();
    expect(emitMock).toHaveBeenCalledWith(
      "incident.updated",
      expect.objectContaining({ changes: expect.objectContaining({ status: "resolved" }) }),
    );
    expect(emitMock).toHaveBeenCalledWith(
      "incident.resolved",
      expect.objectContaining({ incidentId: "inc-1", durationMs: expect.any(Number) }),
    );
    const resolvedCall = emitMock.mock.calls.find((c) => c[0] === "incident.resolved");
    expect((resolvedCall![1] as { durationMs: number }).durationMs).toBeGreaterThan(0);
  });

  it("does NOT emit incident.resolved on a non-resolution update", async () => {
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "inc-1",
          eventId: "evt-1",
          organizationId: "org-1",
          kind: "logistics",
          severity: "medium",
          status: "open",
          description: "x",
          location: null,
          reportedBy: "u-1",
          assignedTo: null,
          resolutionNote: null,
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:00:00.000Z",
          resolvedAt: null,
        }) satisfies Incident,
    });

    const user = buildOrganizerUser("org-1");
    await incidentService.update("inc-1", { assignedTo: "u-org" }, user);

    expect(emitMock).toHaveBeenCalledWith("incident.updated", expect.any(Object));
    expect(emitMock).not.toHaveBeenCalledWith("incident.resolved", expect.any(Object));
  });

  it("404s when the incident doesn't exist", async () => {
    setStoredDoc(null);
    const user = buildOrganizerUser("org-1");
    await expect(
      incidentService.update("missing", { status: "triaged" }, user),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects callers from another organisation", async () => {
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "inc-1",
          eventId: "evt-1",
          organizationId: "org-1",
          kind: "other",
          severity: "low",
          status: "open",
          description: "x",
          location: null,
          reportedBy: "u-1",
          assignedTo: null,
          resolutionNote: null,
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:00:00.000Z",
          resolvedAt: null,
        }) satisfies Incident,
    });
    const otherOrg = buildOrganizerUser("org-2");
    await expect(
      incidentService.update("inc-1", { status: "triaged" }, otherOrg),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
