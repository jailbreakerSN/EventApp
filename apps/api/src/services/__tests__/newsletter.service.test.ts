import { describe, it, expect, vi, beforeEach } from "vitest";
import { NewsletterService } from "../newsletter.service";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockDocRef = { id: "sub-1", set: mockDocSet };
const mockWhereGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockDocRef),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ get: mockWhereGet })),
      })),
    })),
  },
  COLLECTIONS: {
    NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new NewsletterService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewsletterService.subscribe", () => {
  it("creates a new subscriber when email is not yet subscribed", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });

    await service.subscribe("new@example.com");

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub-1",
        email: "new@example.com",
        isActive: true,
        source: "website",
      }),
    );
  });

  it("normalizes email to lowercase", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });

    await service.subscribe("Test@Example.COM");

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "test@example.com",
      }),
    );
  });

  it("returns silently for duplicate subscriptions (idempotent)", async () => {
    mockWhereGet.mockResolvedValue({
      empty: false,
      docs: [{ id: "existing" }],
    });

    await service.subscribe("existing@example.com");

    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it("rejects invalid email format", async () => {
    await expect(service.subscribe("not-an-email")).rejects.toThrow("Adresse e-mail invalide");
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it("rejects empty email string", async () => {
    await expect(service.subscribe("")).rejects.toThrow("Adresse e-mail invalide");
  });

  it("includes timestamps in subscriber document", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });

    await service.subscribe("timestamps@example.com");

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        subscribedAt: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
  });
});
