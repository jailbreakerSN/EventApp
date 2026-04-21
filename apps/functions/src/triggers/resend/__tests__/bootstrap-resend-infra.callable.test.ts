import { describe, it, expect, vi, beforeEach } from "vitest";

// HttpsError shim hoisted alongside vi.mock so the factory can reference
// it without tripping the TDZ. Mirrors the SDK's `{ code, message }`
// surface so tests can `toMatchObject({ code: "permission-denied" })`.
const { MockHttpsError } = vi.hoisted(() => ({
  MockHttpsError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "HttpsError";
    }
  },
}));

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({ name, value: () => "re_test" }),
}));

const { mockSegmentsCreate, mockWebhooksList, mockWebhooksCreate, mockAddSecretVersion } =
  vi.hoisted(() => ({
    mockSegmentsCreate: vi.fn(),
    mockWebhooksList: vi.fn(),
    mockWebhooksCreate: vi.fn(),
    mockAddSecretVersion: vi.fn().mockResolvedValue([{}]),
  }));

vi.mock("../../../utils/resend-client", () => ({
  RESEND_API_KEY: { name: "RESEND_API_KEY", value: () => "re_test" },
  getResend: () => ({
    segments: { create: mockSegmentsCreate },
    webhooks: { list: mockWebhooksList, create: mockWebhooksCreate },
  }),
}));

vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    addSecretVersion = mockAddSecretVersion;
  },
}));

const { configState } = vi.hoisted(() => ({
  configState: { newsletterSegmentId: undefined as string | undefined },
}));

vi.mock("../config-store", () => ({
  getResendSystemConfig: async () => ({ ...configState }),
  updateResendSystemConfig: async (patch: Record<string, unknown>) => {
    Object.assign(configState, patch);
  },
}));

import { bootstrapResendInfra } from "../bootstrap-resend-infra.callable";

type FakeCallableRequest = {
  auth?: { token: { super_admin?: boolean } } | null;
};

const handler = bootstrapResendInfra as unknown as (request: FakeCallableRequest) => Promise<{
  segmentId: string;
  segmentCreated: boolean;
  webhookId: string;
  webhookReused: boolean;
  webhookSecretWritten: boolean;
}>;

const superAdmin: FakeCallableRequest = { auth: { token: { super_admin: true } } };
const regularUser: FakeCallableRequest = { auth: { token: {} } };
const anonymous: FakeCallableRequest = { auth: null };

beforeEach(() => {
  vi.clearAllMocks();
  configState.newsletterSegmentId = undefined;
  process.env.RESEND_WEBHOOK_URL = "https://functions.example.com/resendWebhook";
  process.env.GCLOUD_PROJECT = "teranga-app-990a8";
});

describe("bootstrapResendInfra", () => {
  it("refuses non-super_admin callers with permission-denied", async () => {
    await expect(handler(regularUser)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(handler(anonymous)).rejects.toMatchObject({ code: "permission-denied" });
    expect(mockSegmentsCreate).not.toHaveBeenCalled();
  });

  it("refuses to run when RESEND_WEBHOOK_URL is unset (failed-precondition)", async () => {
    delete process.env.RESEND_WEBHOOK_URL;
    await expect(handler(superAdmin)).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("creates segment + webhook on first run and writes signing secret to Secret Manager", async () => {
    mockSegmentsCreate.mockResolvedValue({ data: { id: "seg_new" }, error: null });
    mockWebhooksList.mockResolvedValue({ data: { data: [] }, error: null });
    mockWebhooksCreate.mockResolvedValue({
      data: { id: "wh_new", signing_secret: "whsec_generated" },
      error: null,
    });

    const result = await handler(superAdmin);

    expect(result).toMatchObject({
      segmentId: "seg_new",
      segmentCreated: true,
      webhookId: "wh_new",
      webhookReused: false,
      webhookSecretWritten: true,
    });

    // Segment was created via the API, not manually in the dashboard.
    expect(mockSegmentsCreate).toHaveBeenCalledWith({ name: expect.stringContaining("Teranga") });

    // Signing secret was piped into Secret Manager (not returned to the
    // caller). Parent path matches the staging project id + expected secret name.
    expect(mockAddSecretVersion).toHaveBeenCalledWith({
      parent: "projects/teranga-app-990a8/secrets/RESEND_WEBHOOK_SECRET",
      payload: { data: Buffer.from("whsec_generated", "utf8") },
    });

    // Config was persisted so triggers read the segment id.
    expect(configState.newsletterSegmentId).toBe("seg_new");
  });

  it("reuses an existing webhook when the endpoint already matches (idempotent)", async () => {
    configState.newsletterSegmentId = "seg_existing";
    mockWebhooksList.mockResolvedValue({
      data: {
        data: [{ id: "wh_existing", endpoint: "https://functions.example.com/resendWebhook" }],
      },
      error: null,
    });

    const result = await handler(superAdmin);

    expect(result).toMatchObject({
      segmentId: "seg_existing",
      segmentCreated: false,
      webhookId: "wh_existing",
      webhookReused: true,
      webhookSecretWritten: false,
    });
    // A second run on an already-bootstrapped project must NOT create new
    // resources or rotate the signing secret — that would invalidate the
    // currently-valid secret in Secret Manager.
    expect(mockSegmentsCreate).not.toHaveBeenCalled();
    expect(mockWebhooksCreate).not.toHaveBeenCalled();
    expect(mockAddSecretVersion).not.toHaveBeenCalled();
  });

  it("surfaces Resend segment-create failures as internal errors", async () => {
    mockSegmentsCreate.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "name too long" },
    });

    await expect(handler(superAdmin)).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("segments.create"),
    });
  });

  it("surfaces Resend webhook-create failures as internal errors", async () => {
    mockSegmentsCreate.mockResolvedValue({ data: { id: "seg_x" }, error: null });
    mockWebhooksList.mockResolvedValue({ data: { data: [] }, error: null });
    mockWebhooksCreate.mockResolvedValue({
      data: null,
      error: { name: "authorization_error", message: "bad api key" },
    });

    await expect(handler(superAdmin)).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("webhooks.create"),
    });
  });

  it("warns (but does not throw) if Resend omits the signing_secret on create", async () => {
    mockSegmentsCreate.mockResolvedValue({ data: { id: "seg_x" }, error: null });
    mockWebhooksList.mockResolvedValue({ data: { data: [] }, error: null });
    mockWebhooksCreate.mockResolvedValue({ data: { id: "wh_x" }, error: null }); // no signing_secret

    const result = await handler(superAdmin);
    expect(result.webhookSecretWritten).toBe(false);
    expect(mockAddSecretVersion).not.toHaveBeenCalled();
  });
});
