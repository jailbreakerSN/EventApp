import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({ name, value: () => "re_test" }),
}));

const { mockContactsList, firestoreDocs } = vi.hoisted(() => ({
  mockContactsList: vi.fn(),
  firestoreDocs: [] as Array<{ email: string }>,
}));

vi.mock("../../../utils/resend-client", () => ({
  RESEND_API_KEY: { name: "RESEND_API_KEY", value: () => "re_test" },
  getResend: () => ({ contacts: { list: mockContactsList } }),
}));

vi.mock("../../../utils/admin", () => ({
  db: {
    collection: () => ({
      where: () => ({
        get: () =>
          Promise.resolve({
            docs: firestoreDocs.map((d) => ({ data: () => d })),
          }),
      }),
    }),
  },
  COLLECTIONS: { NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers" },
}));

const { configState } = vi.hoisted(() => ({
  configState: { newsletterSegmentId: "seg_test" as string | undefined },
}));

vi.mock("../config-store", () => ({
  getResendSystemConfig: async () => ({ ...configState }),
}));

// Pull the logger handle after mocks are wired so we can assert on info()
// calls. The `logger` export is the same mock object we set above.
import { logger } from "firebase-functions/v2";
import { reconcileResendSegment } from "../reconcile-resend-segment.scheduled";

const handler = reconcileResendSegment as unknown as () => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  configState.newsletterSegmentId = "seg_test";
  firestoreDocs.length = 0;
});

describe("reconcileResendSegment", () => {
  it("skips cleanly when the segment hasn't been configured yet", async () => {
    configState.newsletterSegmentId = undefined;
    await handler();
    expect(mockContactsList).not.toHaveBeenCalled();
  });

  it("logs the drift between Firestore and Resend", async () => {
    firestoreDocs.push({ email: "both@test.com" }, { email: "onlyfirestore@test.com" });
    mockContactsList.mockResolvedValue({
      data: {
        data: [
          { email: "both@test.com", unsubscribed: false },
          { email: "onlyresend@test.com", unsubscribed: false },
          { email: "unsub@test.com", unsubscribed: true },
        ],
      },
      error: null,
    });

    await handler();

    expect(logger.info).toHaveBeenCalledWith(
      "Resend segment reconciliation",
      expect.objectContaining({
        firestoreActive: 2,
        resendActive: 2,
        resendUnsubscribed: 1,
        drift: {
          inFirestoreNotResend: 1,
          inResendNotFirestore: 1,
          resendUnsubYetFirestoreActive: 0,
        },
      }),
    );
  });

  it("flags Resend-side unsubscribes that Firestore still shows as active (missed webhook)", async () => {
    firestoreDocs.push({ email: "orphan@test.com" });
    mockContactsList.mockResolvedValue({
      data: {
        data: [{ email: "orphan@test.com", unsubscribed: true }],
      },
      error: null,
    });

    await handler();

    const reconCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "Resend segment reconciliation",
    );
    expect(reconCall).toBeDefined();
    expect(reconCall![1]).toMatchObject({
      drift: expect.objectContaining({ resendUnsubYetFirestoreActive: 1 }),
    });
  });

  it("rethrows when Resend contacts.list fails so the scheduler reports the job as failed", async () => {
    mockContactsList.mockResolvedValue({
      data: null,
      error: { name: "api_error", message: "server error" },
    });

    await expect(handler()).rejects.toThrow(/contacts.list/);
  });

  it("is case-insensitive when comparing emails across stores", async () => {
    firestoreDocs.push({ email: "Mixed@Case.Com" });
    mockContactsList.mockResolvedValue({
      data: { data: [{ email: "mixed@case.com", unsubscribed: false }] },
      error: null,
    });

    await handler();

    expect(logger.info).toHaveBeenCalledWith(
      "Resend segment reconciliation",
      expect.objectContaining({
        drift: {
          inFirestoreNotResend: 0,
          inResendNotFirestore: 0,
          resendUnsubYetFirestoreActive: 0,
        },
      }),
    );
  });
});
