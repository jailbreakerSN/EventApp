import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus } from "../event-bus";
import {
  type RegistrationCreatedEvent,
  type RegistrationApprovedEvent,
  type BadgeGeneratedEvent,
  type EventCancelledEvent,
} from "../domain-events";
import { type Registration } from "@teranga/shared-types";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockNotificationSend = vi.fn().mockResolvedValue({});

vi.mock("@/services/notification.service", () => ({
  notificationService: {
    send: (...args: unknown[]) => mockNotificationSend(...args),
  },
}));

const mockSendRegistrationConfirmation = vi.fn().mockResolvedValue(undefined);
const mockSendRegistrationApproved = vi.fn().mockResolvedValue(undefined);
const mockSendBadgeReady = vi.fn().mockResolvedValue(undefined);
const mockSendEventCancelled = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/email.service", () => ({
  emailService: {
    sendRegistrationConfirmation: (...args: unknown[]) => mockSendRegistrationConfirmation(...args),
    sendRegistrationApproved: (...args: unknown[]) => mockSendRegistrationApproved(...args),
    sendBadgeReady: (...args: unknown[]) => mockSendBadgeReady(...args),
    sendEventCancelled: (...args: unknown[]) => mockSendEventCancelled(...args),
  },
}));

const mockSmsSend = vi.fn().mockResolvedValue({ success: true });

vi.mock("@/providers/index", () => ({
  getSmsProvider: () => ({ send: mockSmsSend }),
  getEmailProvider: () => ({
    send: vi.fn().mockResolvedValue({ success: true }),
  }),
  SMS_TEMPLATES: {
    registrationConfirmed: (title: string) => `Confirmed: ${title}`,
    registrationApproved: (title: string) => `Approved: ${title}`,
    paymentConfirmed: (title: string, amount: string) => `Payment ${amount}: ${title}`,
  },
  buildRegistrationEmail: vi.fn().mockReturnValue({
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
  }),
}));

const mockUserFindById = vi.fn();

vi.mock("@/repositories/user.repository", () => ({
  userRepository: {
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
}));

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

// ─── Helpers ────────────────────────────────────────────────────────────────

const flushImmediate = () => new Promise((r) => setImmediate(r));

const baseEvent = {
  id: "ev-1",
  title: "Test Event",
  startDate: "2026-05-01T10:00:00.000Z",
  location: { name: "Test Venue", address: "123 Test St", city: "Dakar", country: "SN" },
};

const baseUser = {
  uid: "u-1",
  email: "user@test.com",
  displayName: "Test User",
  phone: "+221770001234",
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Notification Listener", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    eventBus.removeAllListeners();
    // Register listeners fresh for each test
    const { registerNotificationListeners } = await import("../listeners/notification.listener");
    registerNotificationListeners();

    mockEventFindById.mockResolvedValue(baseEvent);
    mockUserFindById.mockResolvedValue(baseUser);
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  describe("registration.created", () => {
    const payload: RegistrationCreatedEvent = {
      registration: {
        id: "reg-1",
        eventId: "ev-1",
        userId: "u-1",
        eventTitle: "Test Event",
        ticketTypeName: "Standard",
        participantName: "Test User",
        participantEmail: "user@test.com",
      } as Registration,
      eventId: "ev-1",
      organizationId: "org-1",
      actorId: "u-1",
      requestId: "req-1",
      timestamp: new Date().toISOString(),
    };

    it("sends in-app notification", async () => {
      eventBus.emit("registration.created", payload);
      await flushImmediate();

      expect(mockNotificationSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u-1",
          type: "registration_confirmed",
        }),
      );
    });

    it("sends SMS when user has phone", async () => {
      eventBus.emit("registration.created", payload);
      await flushImmediate();

      expect(mockSmsSend).toHaveBeenCalledWith(
        "+221770001234",
        expect.stringContaining("Test Event"),
      );
    });

    it("sends confirmation email via emailService", async () => {
      eventBus.emit("registration.created", payload);
      await flushImmediate();

      expect(mockSendRegistrationConfirmation).toHaveBeenCalledWith(
        "u-1",
        expect.objectContaining({
          participantName: "Test User",
          eventTitle: "Test Event",
          ticketName: "Standard",
          registrationId: "reg-1",
        }),
      );
    });
  });

  describe("registration.approved", () => {
    const payload: RegistrationApprovedEvent = {
      registrationId: "reg-1",
      eventId: "ev-1",
      userId: "u-1",
      organizationId: "org-1",
      actorId: "admin-1",
      requestId: "req-2",
      timestamp: new Date().toISOString(),
    };

    it("sends in-app notification", async () => {
      eventBus.emit("registration.approved", payload);
      await flushImmediate();

      expect(mockNotificationSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u-1",
          type: "registration_approved",
        }),
      );
    });

    it("sends approval email via emailService", async () => {
      eventBus.emit("registration.approved", payload);
      await flushImmediate();

      expect(mockSendRegistrationApproved).toHaveBeenCalledWith(
        "u-1",
        expect.objectContaining({
          participantName: "Test User",
          eventTitle: "Test Event",
        }),
      );
    });
  });

  describe("badge.generated", () => {
    const payload: BadgeGeneratedEvent = {
      badgeId: "badge-1",
      registrationId: "reg-1",
      eventId: "ev-1",
      userId: "u-1",
      actorId: "system",
      requestId: "req-3",
      timestamp: new Date().toISOString(),
    };

    it("sends in-app notification", async () => {
      eventBus.emit("badge.generated", payload);
      await flushImmediate();

      expect(mockNotificationSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u-1",
          type: "badge_ready",
        }),
      );
    });

    it("sends badge-ready email via emailService", async () => {
      eventBus.emit("badge.generated", payload);
      await flushImmediate();

      expect(mockSendBadgeReady).toHaveBeenCalledWith(
        "u-1",
        expect.objectContaining({
          participantName: "Test User",
          eventTitle: "Test Event",
        }),
      );
    });
  });

  describe("event.cancelled", () => {
    const payload: EventCancelledEvent = {
      eventId: "ev-1",
      organizationId: "org-1",
      actorId: "admin-1",
      requestId: "req-4",
      timestamp: new Date().toISOString(),
    };

    it("sends cancellation email to all registered participants", async () => {
      mockFindByEventCursor.mockResolvedValue({
        data: [
          { userId: "u-1", participantName: "User 1" },
          { userId: "u-2", participantName: "User 2" },
        ],
        lastDoc: null,
      });

      eventBus.emit("event.cancelled", payload);
      await flushImmediate();

      expect(mockSendEventCancelled).toHaveBeenCalledTimes(2);
      expect(mockSendEventCancelled).toHaveBeenCalledWith(
        "u-1",
        expect.objectContaining({ participantName: "User 1", eventTitle: "Test Event" }),
      );
      expect(mockSendEventCancelled).toHaveBeenCalledWith(
        "u-2",
        expect.objectContaining({ participantName: "User 2", eventTitle: "Test Event" }),
      );
    });

    it("does nothing when event is not found", async () => {
      mockEventFindById.mockResolvedValue(null);

      eventBus.emit("event.cancelled", payload);
      await flushImmediate();

      expect(mockSendEventCancelled).not.toHaveBeenCalled();
    });
  });
});
