import { describe, it, expect } from "vitest";
import type { UserRole } from "@teranga/shared-types";
import {
  ADMIN_ROLES,
  BACKOFFICE_ROLES,
  ORGANIZER_ROLES,
  VENUE_ROLES,
  canViewOrganizerShell,
  isAdminRole,
  isOrganizerRole,
  isVenueRole,
  resolveLandingRoute,
} from "../access";

/**
 * Contract tests on the access-control helpers. These helpers sit at the
 * intersection of login (redirect), dashboard layout (gate), admin layout
 * (gate + cross-shell switcher visibility), and topbar (Administration
 * pill visibility). Any change here ripples across four call-sites, so
 * we pin the behaviour down to a truth table.
 */
describe("lib/access — role taxonomy", () => {
  it("ADMIN_ROLES contains the 6 platform operator roles", () => {
    // Kept in sync with ADMIN_SYSTEM_ROLES in @teranga/shared-types —
    // if a new admin subrole lands, this assertion pins the migration.
    expect([...ADMIN_ROLES]).toEqual([
      "super_admin",
      "platform:super_admin",
      "platform:support",
      "platform:finance",
      "platform:ops",
      "platform:security",
    ]);
  });

  it("BACKOFFICE_ROLES is the union of admin + organizer + venue", () => {
    const expected = new Set<UserRole>([
      ...ADMIN_ROLES,
      ...ORGANIZER_ROLES,
      ...VENUE_ROLES,
    ]);
    expect(new Set(BACKOFFICE_ROLES)).toEqual(expected);
  });

  it("ORGANIZER_ROLES and ADMIN_ROLES do not overlap", () => {
    const adminSet = new Set<string>(ADMIN_ROLES);
    for (const role of ORGANIZER_ROLES) {
      expect(adminSet.has(role)).toBe(false);
    }
  });
});

describe("lib/access — predicates", () => {
  it("isAdminRole is true for each admin subrole and false otherwise", () => {
    for (const role of ADMIN_ROLES) {
      expect(isAdminRole([role])).toBe(true);
    }
    expect(isAdminRole(["organizer"])).toBe(false);
    expect(isAdminRole(["co_organizer"])).toBe(false);
    expect(isAdminRole(["venue_manager"])).toBe(false);
    expect(isAdminRole(["participant"])).toBe(false);
    expect(isAdminRole([])).toBe(false);
  });

  it("isOrganizerRole matches organizer + co_organizer only", () => {
    expect(isOrganizerRole(["organizer"])).toBe(true);
    expect(isOrganizerRole(["co_organizer"])).toBe(true);
    expect(isOrganizerRole(["venue_manager"])).toBe(false);
    expect(isOrganizerRole(["super_admin"])).toBe(false);
  });

  it("isVenueRole matches venue_manager only", () => {
    expect(isVenueRole(["venue_manager"])).toBe(true);
    expect(isVenueRole(["organizer"])).toBe(false);
    expect(isVenueRole(["super_admin"])).toBe(false);
  });

  it("canViewOrganizerShell is true for organizer, co_organizer, venue_manager", () => {
    expect(canViewOrganizerShell(["organizer"])).toBe(true);
    expect(canViewOrganizerShell(["co_organizer"])).toBe(true);
    expect(canViewOrganizerShell(["venue_manager"])).toBe(true);
  });

  it("canViewOrganizerShell is false for PURE admin roles (no organizer hat)", () => {
    for (const role of ADMIN_ROLES) {
      expect(canViewOrganizerShell([role])).toBe(false);
    }
  });

  it("canViewOrganizerShell is true for dual-role admin+organizer", () => {
    expect(canViewOrganizerShell(["super_admin", "organizer"])).toBe(true);
    expect(canViewOrganizerShell(["platform:support", "co_organizer"])).toBe(true);
  });
});

describe("lib/access — resolveLandingRoute", () => {
  it("admins land on /admin/inbox (takes priority over organizer hat)", () => {
    for (const role of ADMIN_ROLES) {
      expect(resolveLandingRoute([role])).toBe("/admin/inbox");
    }
    // Dual-role admin still lands on /admin/inbox — admins choose the
    // switcher to cross over; defaulting to orga would break the fix.
    expect(resolveLandingRoute(["super_admin", "organizer"])).toBe("/admin/inbox");
  });

  it("pure organizers land on /dashboard", () => {
    expect(resolveLandingRoute(["organizer"])).toBe("/dashboard");
    expect(resolveLandingRoute(["co_organizer"])).toBe("/dashboard");
  });

  it("pure venue_manager lands on /venues", () => {
    expect(resolveLandingRoute(["venue_manager"])).toBe("/venues");
  });

  it("anything else lands on /unauthorized (safety net)", () => {
    expect(resolveLandingRoute(["participant"])).toBe("/unauthorized");
    expect(resolveLandingRoute(["speaker"])).toBe("/unauthorized");
    expect(resolveLandingRoute(["sponsor"])).toBe("/unauthorized");
    expect(resolveLandingRoute(["staff"])).toBe("/unauthorized");
    expect(resolveLandingRoute([])).toBe("/unauthorized");
  });
});
