import { describe, it, expect } from "vitest";
import {
  resolvePermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  type RoleAssignment,
  type PermissionContext,
} from "../permissions.types";

function assignment(
  role: RoleAssignment["role"],
  scope: RoleAssignment["scope"] = "global",
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  return {
    id: `test-${role}`,
    userId: "user1",
    role,
    scope,
    organizationId: scope === "organization" ? "org1" : null,
    eventId: scope === "event" ? "event1" : null,
    grantedBy: "system",
    grantedAt: new Date().toISOString(),
    isActive: true,
    ...overrides,
  };
}

describe("resolvePermissions", () => {
  it("returns participant permissions for participant role", () => {
    const perms = resolvePermissions([assignment("participant")], {});
    expect(perms.has("registration:create")).toBe(true);
    expect(perms.has("badge:view_own")).toBe(true);
    expect(perms.has("event:create")).toBe(false);
    expect(perms.has("checkin:scan")).toBe(false);
  });

  it("returns organizer permissions including event management", () => {
    const perms = resolvePermissions(
      [assignment("organizer", "organization")],
      { organizationId: "org1" },
    );
    expect(perms.has("event:create")).toBe(true);
    expect(perms.has("event:publish")).toBe(true);
    expect(perms.has("registration:read_all")).toBe(true);
    expect(perms.has("badge:generate")).toBe(true);
    expect(perms.has("checkin:scan")).toBe(true);
  });

  it("super_admin gets ALL permissions", () => {
    const perms = resolvePermissions([assignment("super_admin")], {});
    expect(perms.has("platform:manage")).toBe(true);
    expect(perms.has("event:create")).toBe(true);
    expect(perms.has("checkin:scan")).toBe(true);
    expect(perms.has("sponsor:collect_leads")).toBe(true);
  });

  it("skips inactive assignments", () => {
    const perms = resolvePermissions(
      [assignment("organizer", "organization", { isActive: false })],
      { organizationId: "org1" },
    );
    expect(perms.has("event:create")).toBe(false);
  });

  it("organization-scoped role does not apply to different org", () => {
    const perms = resolvePermissions(
      [assignment("organizer", "organization", { organizationId: "org1" })],
      { organizationId: "org2" },
    );
    expect(perms.has("event:create")).toBe(false);
  });

  it("event-scoped role applies only to matching event", () => {
    const perms = resolvePermissions(
      [assignment("staff", "event", { eventId: "event1" })],
      { eventId: "event1" },
    );
    expect(perms.has("checkin:scan")).toBe(true);

    const perms2 = resolvePermissions(
      [assignment("staff", "event", { eventId: "event1" })],
      { eventId: "event2" },
    );
    expect(perms2.has("checkin:scan")).toBe(false);
  });

  it("merges permissions from multiple roles", () => {
    const perms = resolvePermissions(
      [assignment("participant"), assignment("speaker")],
      {},
    );
    // participant has registration:create, speaker has event:read
    expect(perms.has("registration:create")).toBe(true);
    expect(perms.has("event:read")).toBe(true);
  });
});

describe("hasPermission", () => {
  it("returns true for present permission", () => {
    const perms = new Set(["event:create", "event:read"] as const);
    expect(hasPermission(perms as any, "event:create")).toBe(true);
  });

  it("returns false for missing permission", () => {
    const perms = new Set(["event:read"] as const);
    expect(hasPermission(perms as any, "event:create")).toBe(false);
  });

  it("platform:manage implies everything", () => {
    const perms = new Set(["platform:manage"] as const);
    expect(hasPermission(perms as any, "event:create")).toBe(true);
    expect(hasPermission(perms as any, "checkin:scan")).toBe(true);
  });
});

describe("hasAllPermissions", () => {
  it("returns true when all present", () => {
    const perms = new Set(["event:create", "event:read", "event:update"] as const);
    expect(hasAllPermissions(perms as any, ["event:create", "event:read"])).toBe(true);
  });

  it("returns false when one is missing", () => {
    const perms = new Set(["event:read"] as const);
    expect(hasAllPermissions(perms as any, ["event:create", "event:read"])).toBe(false);
  });
});

describe("hasAnyPermission", () => {
  it("returns true when at least one present", () => {
    const perms = new Set(["event:read"] as const);
    expect(hasAnyPermission(perms as any, ["event:create", "event:read"])).toBe(true);
  });

  it("returns false when none present", () => {
    const perms = new Set(["badge:view_own"] as const);
    expect(hasAnyPermission(perms as any, ["event:create", "event:read"])).toBe(false);
  });
});
