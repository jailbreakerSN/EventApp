import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";

vi.mock("@/config/firebase", () => ({
  db: {},
  COLLECTIONS: {},
}));
vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
  getRequestContext: () => ({ requestId: "test-request-id" }),
  trackFirestoreReads: vi.fn(),
}));

import { commsTemplateService } from "../comms-template.service";
import { SEED_COMMS_TEMPLATES } from "@teranga/shared-types";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommsTemplateService.list — read-only access to seeded templates", () => {
  it("returns all 12 seeded templates for an organizer", () => {
    const user = buildOrganizerUser("org-1");
    const result = commsTemplateService.list(user);
    expect(result).toHaveLength(12);
    expect(result).toEqual(SEED_COMMS_TEMPLATES);
  });

  it("filters by category when ?category is provided", () => {
    const user = buildOrganizerUser("org-1");
    const reminders = commsTemplateService.list(user, { category: "reminder" });
    expect(reminders.every((t) => t.category === "reminder")).toBe(true);
    expect(reminders.length).toBeGreaterThan(0);

    const reengagement = commsTemplateService.list(user, { category: "reengagement" });
    expect(reengagement.every((t) => t.category === "reengagement")).toBe(true);
    expect(reengagement.length).toBeGreaterThan(0);
  });

  it("rejects callers without broadcast:read permission", () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    expect(() => commsTemplateService.list(participant)).toThrowError(ForbiddenError);
  });

  it("super_admin can list templates regardless of org context", () => {
    const admin = buildAuthUser({ roles: ["super_admin"], organizationId: undefined });
    const result = commsTemplateService.list(admin);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("CommsTemplateService.getById — single-template fetch", () => {
  it("returns the matching template", () => {
    const user = buildOrganizerUser("org-1");
    const template = commsTemplateService.getById(user, "reminder-j7");
    expect(template).not.toBeNull();
    expect(template?.label).toBe("Rappel J-7");
  });

  it("returns null on unknown id", () => {
    const user = buildOrganizerUser("org-1");
    expect(commsTemplateService.getById(user, "missing-template")).toBeNull();
  });

  it("rejects callers without broadcast:read", () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    expect(() => commsTemplateService.getById(participant, "reminder-j7")).toThrowError(
      ForbiddenError,
    );
  });
});
