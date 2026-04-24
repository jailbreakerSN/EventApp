import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePermissions } from "../use-permissions";

// ─── usePermissions — client-side role → permission resolution ───────────
// The backoffice mirrors the API's shared-types `DEFAULT_ROLE_PERMISSIONS`
// map to hide / disable UI controls before the user ever attempts a
// mutation. Every test here pins a property that the API's
// `requirePermission()` middleware also relies on — drift between the
// two layers causes either (a) widgets that 403 on click or (b) blocked
// users who should be able to act. Both are regressions.

const mockUseAuth = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePermissions — role → permission resolution", () => {
  it("super_admin collapses to platform:manage (implies everything)", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["super_admin"] } });

    const { result } = renderHook(() => usePermissions());

    // Every `.can(...)` check short-circuits to true for super_admin via
    // the platform:manage sentinel — this is the behaviour the server
    // also implements (`resolvePermissions` returns PermissionSchema.options
    // when it sees platform:manage). The hook's set only needs the
    // sentinel itself; full expansion happens at call time via
    // `hasPermissionInSet`.
    expect(result.current.permissions.has("platform:manage")).toBe(true);
    expect(result.current.can("event:read")).toBe(true);
    expect(result.current.can("organization:read")).toBe(true);
    expect(result.current.can("venue:update")).toBe(true);
  });

  it("organizer gets event + organization permissions but not venue", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.can("event:read")).toBe(true);
    expect(result.current.can("event:update")).toBe(true);
    expect(result.current.can("organization:read")).toBe(true);
    // venue_manager-only permission — organizer does NOT hold it.
    expect(result.current.can("venue:update")).toBe(false);
  });

  it("venue_manager gets venue:* only — not event:read or organization:read", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["venue_manager"] } });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.can("venue:read")).toBe(true);
    expect(result.current.can("venue:update")).toBe(true);
    expect(result.current.can("venue:view_events")).toBe(true);
    // Crucial — this is exactly the permission the dashboard home
    // queries. A venue_manager landing on /dashboard was seeing a 403
    // storm before this hook gated the queries.
    expect(result.current.can("event:read")).toBe(false);
    expect(result.current.can("organization:read")).toBe(false);
  });

  it("combines multiple roles via union — participant + venue_manager merges both sets", () => {
    // Realistic seed data: a venue manager is also a participant so
    // they can register for events. Previously `user.roles[0]` pinned
    // them to `participant` in the topbar chip and masked their
    // venue-manager permissions downstream.
    mockUseAuth.mockReturnValue({ user: { roles: ["participant", "venue_manager"] } });

    const { result } = renderHook(() => usePermissions());

    // Participant base
    expect(result.current.can("registration:create")).toBe(true);
    expect(result.current.can("badge:view_own")).toBe(true);
    // Venue-manager add-ons
    expect(result.current.can("venue:update")).toBe(true);
    expect(result.current.can("venue:view_events")).toBe(true);
    // Still no org-wide access
    expect(result.current.can("event:read")).toBe(false);
  });

  it("unknown / future roles are skipped without throwing", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["mystery_role"] } });

    const { result } = renderHook(() => usePermissions());

    // Empty set, every check returns false.
    expect(result.current.permissions.size).toBe(0);
    expect(result.current.can("event:read")).toBe(false);
  });

  it("canAll / canAny compose correctly around platform:manage", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    const { result } = renderHook(() => usePermissions());

    // Organizer holds both of these, canAll == true.
    expect(result.current.canAll(["event:read", "event:update"])).toBe(true);
    // Organizer does NOT hold venue:update, canAll must be false.
    expect(result.current.canAll(["event:read", "venue:update"])).toBe(false);
    // canAny with at least one hit → true.
    expect(result.current.canAny(["venue:update", "event:read"])).toBe(true);
    // canAny with none held → false.
    expect(result.current.canAny(["venue:update", "venue:read"])).toBe(false);
  });

  it("super_admin short-circuits canAll / canAny even for empty lists", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["super_admin"] } });
    const { result } = renderHook(() => usePermissions());

    expect(result.current.canAll([])).toBe(true);
    expect(result.current.canAll(["event:read", "venue:update"])).toBe(true);
    expect(result.current.canAny(["venue:update"])).toBe(true);
  });
});
