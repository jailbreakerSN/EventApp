import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The impersonation hook imports Firebase Auth + the admin API client. Both
// are mocked out so tests run in isolation. `onAuthStateChanged` in
// particular is exercised — the tests simulate a login / logout /
// impersonation-end cycle and check the banner state reconciles.

const mockCurrentUser = { uid: "admin-current" };
let authListener: ((user: { uid: string } | null) => void) | null = null;

vi.mock("firebase/auth", () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
  signInWithCustomToken: vi.fn().mockResolvedValue({
    user: {
      getIdTokenResult: vi.fn().mockResolvedValue({
        claims: { roles: ["participant"] },
      }),
    },
  }),
  onAuthStateChanged: vi.fn((_auth, cb) => {
    authListener = cb as (user: { uid: string } | null) => void;
    return () => {
      authListener = null;
    };
  }),
}));

vi.mock("@/lib/firebase", () => ({
  firebaseAuth: {
    get currentUser() {
      return mockCurrentUser;
    },
  },
}));

vi.mock("@/lib/api-client", () => ({
  adminApi: {
    impersonate: vi.fn(),
    endImpersonation: vi.fn(),
  },
}));

// Import AFTER mocks
import { useImpersonationState, IMPERSONATION_STORAGE_KEY } from "../use-impersonation";

const FUTURE_ISO = new Date(Date.now() + 10 * 60 * 1000).toISOString();

const SAMPLE_BREADCRUMB = {
  actorUid: "admin-1",
  actorDisplayName: "Admin One",
  targetUid: "user-target",
  targetDisplayName: "Thierno Wade",
  targetEmail: "thierno@teranga.dev",
  expiresAt: FUTURE_ISO,
};

beforeEach(() => {
  window.sessionStorage.clear();
  mockCurrentUser.uid = "admin-current";
  authListener = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── State reconciliation ─────────────────────────────────────────────────────

describe("useImpersonationState — reconciliation against current auth user", () => {
  it("returns null when no breadcrumb is stored", () => {
    const { result } = renderHook(() => useImpersonationState());
    expect(result.current).toBeNull();
  });

  it("returns the breadcrumb when the current UID matches targetUid", async () => {
    window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(SAMPLE_BREADCRUMB));
    mockCurrentUser.uid = SAMPLE_BREADCRUMB.targetUid;

    const { result } = renderHook(() => useImpersonationState());

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.targetUid).toBe(SAMPLE_BREADCRUMB.targetUid);
  });

  it("clears a stale breadcrumb when the admin re-logs in (currentUid !== targetUid)", async () => {
    // This is the exact staging regression: admin signs out, signs back
    // in, but the sessionStorage breadcrumb from the prior impersonation
    // session lingers and shows a phantom banner.
    window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(SAMPLE_BREADCRUMB));
    mockCurrentUser.uid = "admin-back-at-it-again";

    const { result } = renderHook(() => useImpersonationState());

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    // And the stale breadcrumb is physically removed so future renders
    // in other tabs / components do not try to resurrect it.
    expect(window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)).toBeNull();
  });

  it("drops the banner when Firebase fires an auth state change to a different UID", async () => {
    window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(SAMPLE_BREADCRUMB));
    mockCurrentUser.uid = SAMPLE_BREADCRUMB.targetUid;

    const { result } = renderHook(() => useImpersonationState());

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    // Simulate the admin signing back in — Firebase fires onAuthStateChanged
    // with the admin UID; our listener reconciles against the mismatch.
    act(() => {
      mockCurrentUser.uid = "admin-back";
      authListener?.({ uid: "admin-back" });
    });

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)).toBeNull();
  });
});

// ── Auto-expiry ──────────────────────────────────────────────────────────────

describe("useImpersonationState — auto-expiry", () => {
  it("drops a breadcrumb whose expiresAt is in the past", async () => {
    window.sessionStorage.setItem(
      IMPERSONATION_STORAGE_KEY,
      JSON.stringify({
        ...SAMPLE_BREADCRUMB,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    mockCurrentUser.uid = SAMPLE_BREADCRUMB.targetUid;

    const { result } = renderHook(() => useImpersonationState());

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)).toBeNull();
  });
});
