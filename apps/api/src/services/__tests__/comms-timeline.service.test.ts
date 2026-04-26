import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";
import type { Broadcast } from "@teranga/shared-types";

// ─── Comms Timeline service — aggregation contract ────────────────────────
//
// Service-level integration: mock the repos and verify the service
// explodes broadcasts into per-channel entries, sorts them
// chronologically, and surfaces rangeStart/rangeEnd.
//
// The pure helper `broadcastToEntries` is exercised independently —
// it's the load-bearing piece of geometry the timeline relies on.

vi.mock("@/config/firebase", () => ({
  db: {},
  COLLECTIONS: {},
}));
vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
  getRequestContext: () => ({ requestId: "test-request-id" }),
  trackFirestoreReads: vi.fn(),
}));

const mockEventRepoFindByIdOrThrow = vi.fn();
vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findByIdOrThrow: (id: string) => mockEventRepoFindByIdOrThrow(id),
  },
}));

const mockBroadcastRepoFindByEvent = vi.fn();
vi.mock("@/repositories/broadcast.repository", () => ({
  broadcastRepository: {
    findByEvent: (...args: unknown[]) => mockBroadcastRepoFindByEvent(...args),
  },
}));

import { commsTimelineService, broadcastToEntries } from "../comms-timeline.service";

beforeEach(() => {
  vi.clearAllMocks();
});

function buildBroadcast(partial: Partial<Broadcast> & { id: string }): Broadcast {
  return {
    organizationId: "org-1",
    eventId: "evt-1",
    title: `Title ${partial.id}`,
    body: "Body",
    channels: ["email"],
    recipientFilter: "all",
    recipientCount: 10,
    sentCount: 0,
    failedCount: 0,
    status: "scheduled",
    scheduledAt: null,
    createdBy: "u-1",
    createdAt: "2026-04-20T10:00:00.000Z",
    sentAt: null,
    ...partial,
  } as Broadcast;
}

// ─── Pure helper: broadcastToEntries ────────────────────────────────────

describe("broadcastToEntries — broadcast → per-channel rows", () => {
  it("emits one entry per channel", () => {
    const broadcast = buildBroadcast({
      id: "b-1",
      channels: ["email", "push", "sms"],
    });
    const entries = broadcastToEntries(broadcast);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.channel).sort()).toEqual(["email", "push", "sms"]);
  });

  it("uses sentAt when present", () => {
    const broadcast = buildBroadcast({
      id: "b-2",
      sentAt: "2026-04-25T08:00:00.000Z",
      scheduledAt: "2026-04-24T08:00:00.000Z",
      status: "sent",
    });
    expect(broadcastToEntries(broadcast)[0].at).toBe("2026-04-25T08:00:00.000Z");
  });

  it("falls back to scheduledAt when sentAt is null", () => {
    const broadcast = buildBroadcast({
      id: "b-3",
      sentAt: null,
      scheduledAt: "2026-05-01T10:00:00.000Z",
      status: "scheduled",
    });
    expect(broadcastToEntries(broadcast)[0].at).toBe("2026-05-01T10:00:00.000Z");
  });

  it("falls back to createdAt when both sentAt and scheduledAt are null (draft)", () => {
    const broadcast = buildBroadcast({
      id: "b-4",
      sentAt: null,
      scheduledAt: null,
      createdAt: "2026-04-10T07:00:00.000Z",
      status: "draft",
    });
    expect(broadcastToEntries(broadcast)[0].at).toBe("2026-04-10T07:00:00.000Z");
  });

  it("truncates a body longer than 240 chars and adds an ellipsis (cap 240, ellipsis included)", () => {
    const longBody = "a".repeat(300);
    const broadcast = buildBroadcast({ id: "b-5", body: longBody });
    const preview = broadcastToEntries(broadcast)[0].preview;
    // Implementation: slice(0, 237) + "…" → 238 chars. Contract is
    // "≤ 240" so the chart never overflows; we pin the actual length
    // to detect off-by-one regressions in either direction.
    expect(preview.length).toBe(238);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("preserves a short body unchanged", () => {
    const broadcast = buildBroadcast({ id: "b-6", body: "Court message" });
    expect(broadcastToEntries(broadcast)[0].preview).toBe("Court message");
  });

  it("propagates recipient + sent + failed counters to every entry", () => {
    const broadcast = buildBroadcast({
      id: "b-7",
      channels: ["email", "push"],
      recipientCount: 50,
      sentCount: 47,
      failedCount: 3,
    });
    for (const entry of broadcastToEntries(broadcast)) {
      expect(entry.recipientCount).toBe(50);
      expect(entry.sentCount).toBe(47);
      expect(entry.failedCount).toBe(3);
    }
  });
});

// ─── Service: getEventTimeline ──────────────────────────────────────────

describe("CommsTimelineService.getEventTimeline — integration", () => {
  it("aggregates broadcasts into a sorted timeline", async () => {
    mockEventRepoFindByIdOrThrow.mockResolvedValue({
      id: "evt-1",
      organizationId: "org-1",
    });
    mockBroadcastRepoFindByEvent.mockResolvedValue({
      data: [
        buildBroadcast({
          id: "later",
          channels: ["email"],
          scheduledAt: "2026-05-02T10:00:00.000Z",
        }),
        buildBroadcast({
          id: "earlier",
          channels: ["push", "sms"],
          scheduledAt: "2026-05-01T10:00:00.000Z",
        }),
      ],
      meta: { page: 1, limit: 200, total: 2, totalPages: 1 },
    });

    const user = buildOrganizerUser("org-1");
    const result = await commsTimelineService.getEventTimeline("evt-1", user);

    // 3 entries (1 + 2) in chronological order: earliest first.
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].at).toBe("2026-05-01T10:00:00.000Z");
    expect(result.entries[2].at).toBe("2026-05-02T10:00:00.000Z");
    expect(result.rangeStart).toBe("2026-05-01T10:00:00.000Z");
    expect(result.rangeEnd).toBe("2026-05-02T10:00:00.000Z");
  });

  it("returns an empty timeline with null range when no broadcasts exist", async () => {
    mockEventRepoFindByIdOrThrow.mockResolvedValue({
      id: "evt-1",
      organizationId: "org-1",
    });
    mockBroadcastRepoFindByEvent.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 200, total: 0, totalPages: 1 },
    });

    const user = buildOrganizerUser("org-1");
    const result = await commsTimelineService.getEventTimeline("evt-1", user);
    expect(result.entries).toEqual([]);
    expect(result.rangeStart).toBeNull();
    expect(result.rangeEnd).toBeNull();
  });

  it("rejects callers without broadcast:read", async () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    await expect(
      commsTimelineService.getEventTimeline("evt-1", participant),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects callers from another organisation (cross-org)", async () => {
    mockEventRepoFindByIdOrThrow.mockResolvedValue({
      id: "evt-1",
      organizationId: "org-1",
    });
    const otherOrg = buildOrganizerUser("org-2");
    await expect(commsTimelineService.getEventTimeline("evt-1", otherOrg)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
