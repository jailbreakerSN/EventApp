import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { useWebPushRegistration as UseWebPushRegistrationFn } from "../use-web-push-registration";
import type { fingerprintToken as FingerprintTokenFn } from "../../lib/fingerprint-token";

// ─── useWebPushRegistration hook coverage ──────────────────────────────────
// Pins the happy path + every refusal branch of the Phase C.2 Web Push
// lifecycle. Upstream deps mocked at the module boundary so the hook runs
// against deterministic inputs:
//   - firebase/messaging.getToken  → controls the token handed to meApi
//   - @/lib/firebase.getFirebaseMessaging  → controls SDK support
//   - @/lib/api-client.meApi       → controls server response
//   - navigator.serviceWorker      → fakes the SW registration
//   - Notification (global)        → fakes the permission prompt
//
// The fingerprint helper stays real (uses Web Crypto via happy-dom) — it's
// a critical part of the C.1 server contract, not something worth faking.

const mockGetToken = vi.fn();
const mockGetFirebaseMessaging = vi.fn();
const mockRegisterFcmToken = vi.fn();
const mockRevokeFcmToken = vi.fn();
const mockRevokeAllFcmTokens = vi.fn();

vi.mock("firebase/messaging", () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseMessaging: () => mockGetFirebaseMessaging(),
}));

class MockApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

vi.mock("@/lib/api-client", () => ({
  meApi: {
    registerFcmToken: (...args: unknown[]) => mockRegisterFcmToken(...args),
    revokeFcmToken: (...args: unknown[]) => mockRevokeFcmToken(...args),
    revokeAllFcmTokens: () => mockRevokeAllFcmTokens(),
  },
  ApiError: MockApiError,
}));

// ─── Environment setup ─────────────────────────────────────────────────────
// Re-imported AFTER the vi.mock calls above so the hook sees the stubs.
// Types are pulled in via `import type` at the top of the file (those are
// erased at runtime, so they don't re-import the module and bust the mock).
let useWebPushRegistration: typeof UseWebPushRegistrationFn;
let fingerprintToken: typeof FingerprintTokenFn;

beforeEach(async () => {
  vi.resetAllMocks();

  // Reset localStorage between tests — the hook caches the fingerprint there.
  window.localStorage.clear();

  // Fake VAPID + Firebase env for the buildSwUrl helper. Without these the
  // hook short-circuits to `{ ok: false, reason: "error" }` before even
  // prompting. Set before the hook module is imported so buildSwUrl sees
  // them.
  process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = "test-vapid-key";
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "fake-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "fake-project";
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "12345";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "1:12345:web:abc";
  process.env.NEXT_PUBLIC_API_URL = "http://api.local";

  // Mock Notification on the global scope. happy-dom provides a partial
  // implementation but it doesn't expose `requestPermission` reliably.
  const NotificationMock = vi.fn() as unknown as typeof Notification & {
    permission: NotificationPermission;
    requestPermission: () => Promise<NotificationPermission>;
  };
  NotificationMock.permission = "default";
  NotificationMock.requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  (globalThis as unknown as { Notification: typeof Notification }).Notification = NotificationMock;

  // Fake service worker registration API.
  const fakeRegistration = { scope: "/" };
  const registerMock = vi.fn(async () => fakeRegistration);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: registerMock,
      ready: Promise.resolve(fakeRegistration),
    },
  });

  // Dynamic imports — after env + mocks are in place.
  ({ useWebPushRegistration } = await import("../use-web-push-registration"));
  ({ fingerprintToken } = await import("../../lib/fingerprint-token"));
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("useWebPushRegistration — permission surfacing", () => {
  it("starts as 'default' when Notification.permission is default", async () => {
    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() => expect(result.current.permission).toBe("default"));
    expect(result.current.registeredFingerprint).toBeNull();
    expect(result.current.isRegistering).toBe(false);
  });

  it("returns 'unsupported' when Notification is missing (iOS Safari <16.4)", async () => {
    // Simulate the iOS/Safari-pre-16.4 case — Notification is undefined on
    // the global scope entirely. `as unknown as` lets us side-step the
    // type: `globalThis.Notification` is non-optional in lib.dom.d.ts but
    // we genuinely want to remove it for this test.
    (globalThis as unknown as { Notification?: typeof Notification }).Notification = undefined;
    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() => expect(result.current.permission).toBe("unsupported"));
  });

  it("restores the fingerprint from localStorage on mount", async () => {
    window.localStorage.setItem("teranga.push.fingerprint", "abcd1234abcd1234");
    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() =>
      expect(result.current.registeredFingerprint).toBe("abcd1234abcd1234"),
    );
  });
});

describe("useWebPushRegistration — register()", () => {
  it("registers the token, stores the fingerprint, returns ok on success", async () => {
    mockGetFirebaseMessaging.mockResolvedValue({});
    mockGetToken.mockResolvedValue("fcm-token-abc");
    mockRegisterFcmToken.mockResolvedValue({
      success: true,
      data: { tokenFingerprint: "xxx", status: "registered", tokenCount: 1 },
    });

    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() => expect(result.current.permission).toBe("default"));

    let registerResult!: Awaited<ReturnType<typeof result.current.register>>;
    await act(async () => {
      registerResult = await result.current.register();
    });

    expect(registerResult.ok).toBe(true);
    expect(mockRegisterFcmToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: "fcm-token-abc", platform: "web" }),
    );

    // The locally-stored fingerprint MUST match what sha256(token).slice(0,16)
    // produces — this is the contract the server relies on for DELETE /:fp.
    const expectedFp = await fingerprintToken("fcm-token-abc");
    expect(window.localStorage.getItem("teranga.push.fingerprint")).toBe(expectedFp);
    expect(result.current.registeredFingerprint).toBe(expectedFp);
  });

  it("returns permission_denied when the user rejects the prompt", async () => {
    (globalThis.Notification as typeof Notification & {
      requestPermission: () => Promise<NotificationPermission>;
    }).requestPermission = vi.fn(async () => "denied" as NotificationPermission);

    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() => expect(result.current.permission).toBe("default"));

    let registerResult!: Awaited<ReturnType<typeof result.current.register>>;
    await act(async () => {
      registerResult = await result.current.register();
    });

    expect(registerResult.ok).toBe(false);
    expect((registerResult as { reason: string }).reason).toBe("permission_denied");
    expect(mockRegisterFcmToken).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("teranga.push.fingerprint")).toBeNull();
  });

  it("returns unsupported when Firebase messaging isn't available", async () => {
    mockGetFirebaseMessaging.mockResolvedValue(null); // isSupported() → false.
    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() => expect(result.current.permission).toBe("default"));

    let registerResult!: Awaited<ReturnType<typeof result.current.register>>;
    await act(async () => {
      registerResult = await result.current.register();
    });

    expect(registerResult.ok).toBe(false);
    expect((registerResult as { reason: string }).reason).toBe("unsupported");
  });

  it("returns rate_limited on a 429 from the API without retrying", async () => {
    mockGetFirebaseMessaging.mockResolvedValue({});
    mockGetToken.mockResolvedValue("fcm-token-xyz");
    mockRegisterFcmToken.mockRejectedValue(new MockApiError("RATE_LIMITED", "slow down", 429));

    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() => expect(result.current.permission).toBe("default"));

    let registerResult!: Awaited<ReturnType<typeof result.current.register>>;
    await act(async () => {
      registerResult = await result.current.register();
    });

    expect(registerResult.ok).toBe(false);
    expect((registerResult as { reason: string }).reason).toBe("rate_limited");
    expect(mockRegisterFcmToken).toHaveBeenCalledTimes(1); // no retry.
    expect(window.localStorage.getItem("teranga.push.fingerprint")).toBeNull();
  });
});

describe("useWebPushRegistration — revoke()", () => {
  it("calls DELETE with the stored fingerprint and clears localStorage", async () => {
    window.localStorage.setItem("teranga.push.fingerprint", "fp-to-revoke12");
    mockRevokeFcmToken.mockResolvedValue({});

    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() =>
      expect(result.current.registeredFingerprint).toBe("fp-to-revoke12"),
    );

    await act(async () => {
      await result.current.revoke();
    });

    expect(mockRevokeFcmToken).toHaveBeenCalledWith("fp-to-revoke12");
    expect(window.localStorage.getItem("teranga.push.fingerprint")).toBeNull();
    expect(result.current.registeredFingerprint).toBeNull();
  });

  it("revokeAll clears the localStorage even when the API fails (logout must not block)", async () => {
    window.localStorage.setItem("teranga.push.fingerprint", "some-fp-123456ab");
    mockRevokeAllFcmTokens.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useWebPushRegistration());
    await waitFor(() =>
      expect(result.current.registeredFingerprint).toBe("some-fp-123456ab"),
    );

    await act(async () => {
      await result.current.revokeAll();
    });

    expect(mockRevokeAllFcmTokens).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("teranga.push.fingerprint")).toBeNull();
    expect(result.current.registeredFingerprint).toBeNull();
  });
});

// ─── Fingerprint contract ──────────────────────────────────────────────────

describe("fingerprintToken — C.1 server contract", () => {
  it("matches the server's sha256(token).slice(0, 16) hex for a known token", async () => {
    // Pinning a deterministic token→fingerprint pair. If this ever drifts,
    // the server's DELETE /v1/me/fcm-tokens/:fp will silently miss every
    // client revoke call, so this test is load-bearing.
    //
    // Computed against Node's crypto.createHash('sha256') as the reference
    // (same algorithm the server uses): the client MUST produce the same
    // 16-char slice.
    const token = "fcm-abc123";
    // sha256("fcm-abc123") = "22d3ad32837ced32…", slice(0, 16)
    // = "22d3ad32837ced32". Reference computed with Node's crypto.createHash.
    const fp = await fingerprintToken(token);
    expect(fp).toBe("22d3ad32837ced32");
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });
});
