import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus } from "../event-bus";
import { type EventUpdatedEvent } from "../domain-events";
import type { Event, Registration } from "@teranga/shared-types";

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The listener reaches through eventRepository, registrationRepository,
// the `db` batch API and notificationService. We stub every collaborator so
// the test exercises pure fan-out logic without booting Firestore.

const mockEventFindById = vi.fn();
vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findById: (...args: unknown[]) => mockEventFindById(...args),
  },
}));

const mockFindByEventCursor = vi.fn();
vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: {
    findByEventCursor: (...args: unknown[]) => mockFindByEventCursor(...args),
  },
}));

const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockDocRef = vi.fn((id: string) => ({ id }));
vi.mock("@/config/firebase", () => ({
  db: {
    batch: () => ({ update: mockBatchUpdate, commit: mockBatchCommit }),
    collection: () => ({ doc: mockDocRef }),
  },
  COLLECTIONS: { REGISTRATIONS: "registrations" },
}));

const mockNotificationSend = vi.fn().mockResolvedValue({});
vi.mock("@/services/notification.service", () => ({
  notificationService: {
    send: (...args: unknown[]) => mockNotificationSend(...args),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

const basePayload = (changes: Record<string, unknown>): EventUpdatedEvent => ({
  eventId: "ev-1",
  organizationId: "org-1",
  changes,
  actorId: "u-admin",
  requestId: "req-1",
  timestamp: "2026-04-19T10:00:00.000Z",
});

const buildEvent = (overrides: Partial<Event> = {}): Event =>
  ({
    id: "ev-1",
    title: "New Title",
    slug: "new-slug",
    startDate: "2026-06-01T09:00:00.000Z",
    endDate: "2026-06-01T18:00:00.000Z",
    organizationId: "org-1",
    status: "published",
    location: { name: "Venue", city: "Dakar", country: "SN", address: "" },
    ...overrides,
  }) as unknown as Event;

const buildReg = (id: string, userId: string): Registration =>
  ({
    id,
    userId,
    eventId: "ev-1",
    status: "confirmed",
  }) as unknown as Registration;

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // `clearAllMocks` doesn't wipe `mockResolvedValueOnce` queues, so a test
  // that enqueues a page that never gets consumed would leak into the next
  // test. Reset implementations explicitly before each run.
  mockEventFindById.mockReset();
  mockFindByEventCursor.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchCommit.mockReset().mockResolvedValue(undefined);
  mockNotificationSend.mockReset().mockResolvedValue({});
  mockDocRef.mockReset().mockImplementation((id: string) => ({ id }));

  eventBus.removeAllListeners();
  const { registerEventDenormListeners } = await import("../listeners/event-denorm.listener");
  registerEventDenormListeners();
});

afterEach(() => {
  eventBus.removeAllListeners();
});

describe("Event Denorm Listener", () => {
  it("ignores event.updated when no denormalized field changed", async () => {
    mockEventFindById.mockResolvedValue(buildEvent());
    mockFindByEventCursor.mockResolvedValue({ data: [], lastDoc: null });

    eventBus.emit("event.updated", basePayload({ description: "just a description tweak" }));
    await flush();

    expect(mockEventFindById).not.toHaveBeenCalled();
    expect(mockFindByEventCursor).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockNotificationSend).not.toHaveBeenCalled();
  });

  it("fans out title change to every non-cancelled registration without notifying", async () => {
    mockEventFindById.mockResolvedValue(buildEvent({ title: "Renamed Event" }));
    mockFindByEventCursor
      .mockResolvedValueOnce({
        data: [buildReg("reg-1", "u-1"), buildReg("reg-2", "u-2")],
        lastDoc: null,
      })
      .mockResolvedValueOnce({ data: [], lastDoc: null });

    eventBus.emit("event.updated", basePayload({ title: "Renamed Event" }));
    await flush();

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    const [, patch] = mockBatchUpdate.mock.calls[0];
    expect(patch).toMatchObject({ eventTitle: "Renamed Event" });
    expect(patch).not.toHaveProperty("eventStartDate");
    // Title-only change must NOT trigger a schedule notification.
    expect(mockNotificationSend).not.toHaveBeenCalled();
  });

  it("notifies every participant when startDate changes", async () => {
    mockEventFindById.mockResolvedValue(
      buildEvent({ startDate: "2026-06-02T09:00:00.000Z", endDate: "2026-06-02T18:00:00.000Z" }),
    );
    mockFindByEventCursor
      .mockResolvedValueOnce({
        data: [buildReg("reg-1", "u-1"), buildReg("reg-2", "u-2")],
        lastDoc: null,
      })
      .mockResolvedValueOnce({ data: [], lastDoc: null });

    eventBus.emit("event.updated", basePayload({ startDate: "2026-06-02T09:00:00.000Z" }));
    await flush();

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockNotificationSend).toHaveBeenCalledTimes(2);
    const notifyCalls = mockNotificationSend.mock.calls.map(
      (c) => (c[0] as { userId: string }).userId,
    );
    expect(notifyCalls.sort()).toEqual(["u-1", "u-2"]);
    expect(mockNotificationSend.mock.calls[0][0]).toMatchObject({
      type: "event_updated",
      data: { eventId: "ev-1", kind: "schedule_change" },
    });
  });

  it("does nothing when the event was deleted between emit and fan-out", async () => {
    mockEventFindById.mockResolvedValue(null);

    eventBus.emit("event.updated", basePayload({ title: "New" }));
    await flush();

    expect(mockFindByEventCursor).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("swallows batch commit failures so the listener never bubbles up", async () => {
    mockEventFindById.mockResolvedValue(buildEvent({ title: "Renamed Event" }));
    mockFindByEventCursor.mockResolvedValue({
      data: [buildReg("reg-1", "u-1")],
      lastDoc: null,
    });
    mockBatchCommit.mockRejectedValueOnce(new Error("firestore timeout"));

    await expect(async () => {
      eventBus.emit("event.updated", basePayload({ title: "Renamed Event" }));
      await flush();
    }).not.toThrow();
  });
});
