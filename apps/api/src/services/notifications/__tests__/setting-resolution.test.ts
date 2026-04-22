import { describe, it, expect, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/config/firebase", () => ({
  db: { collection: vi.fn() },
  COLLECTIONS: { NOTIFICATION_SETTINGS: "notificationSettings" },
}));

vi.mock("@/repositories/notification-settings.repository", () => ({
  notificationSettingsRepository: {
    findByKey: vi.fn(),
    findByKeyAndOrg: vi.fn(),
  },
  notificationSettingDocId: (key: string, orgId: string | null) =>
    orgId ? `${key}__${orgId}` : key,
}));

import { SettingResolutionService } from "../setting-resolution";
import { notificationSettingsRepository } from "@/repositories/notification-settings.repository";
import { NOTIFICATION_CATALOG_BY_KEY } from "@teranga/shared-types";

// ─── Setup ─────────────────────────────────────────────────────────────────

const service = new SettingResolutionService();

function mockRepo() {
  (notificationSettingsRepository.findByKey as ReturnType<typeof vi.fn>).mockReset();
  (notificationSettingsRepository.findByKeyAndOrg as ReturnType<typeof vi.fn>).mockReset();
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SettingResolutionService", () => {
  it("returns catalog defaults when no override exists", async () => {
    mockRepo();
    (notificationSettingsRepository.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      notificationSettingsRepository.findByKeyAndOrg as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const out = await service.resolve("registration.created", "org-1");
    expect(out.enabled).toBe(true);
    expect(out.channels).toEqual(
      NOTIFICATION_CATALOG_BY_KEY["registration.created"]!.defaultChannels,
    );
    expect(out.source.enabled).toBe("catalog");
    expect(out.source.channels).toBe("catalog");
    expect(out.subjectOverride).toBeUndefined();
  });

  it("platform override beats the catalog default", async () => {
    mockRepo();
    (notificationSettingsRepository.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "registration.created",
      organizationId: null,
      enabled: false,
      channels: ["email"],
      updatedAt: new Date().toISOString(),
      updatedBy: "admin-1",
    });
    (
      notificationSettingsRepository.findByKeyAndOrg as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const out = await service.resolve("registration.created", null);
    expect(out.enabled).toBe(false);
    expect(out.source.enabled).toBe("platform_override");
  });

  it("per-org override beats the platform override", async () => {
    mockRepo();
    (notificationSettingsRepository.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "event.reminder",
      organizationId: null,
      enabled: true,
      channels: ["email"],
      updatedAt: new Date().toISOString(),
      updatedBy: "admin-1",
    });
    (
      notificationSettingsRepository.findByKeyAndOrg as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      key: "event.reminder",
      organizationId: "org-1",
      enabled: false,
      channels: ["email"],
      updatedAt: new Date().toISOString(),
      updatedBy: "organizer-1",
    });

    const out = await service.resolve("event.reminder", "org-1");
    expect(out.enabled).toBe(false);
    expect(out.source.enabled).toBe("organization_override");
    // Both overrides surface on the result so the admin UI can show them.
    expect(out.platformOverride?.enabled).toBe(true);
    expect(out.organizationOverride?.enabled).toBe(false);
  });

  it("filters channels not present in supportedChannels (defense in depth)", async () => {
    mockRepo();
    (notificationSettingsRepository.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "registration.created",
      organizationId: null,
      enabled: true,
      // "sms" is not in supportedChannels for registration.created — the
      // merge helper must drop it even if the admin slipped it in.
      channels: ["email", "sms"],
      updatedAt: new Date().toISOString(),
      updatedBy: "admin-1",
    });
    (
      notificationSettingsRepository.findByKeyAndOrg as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const out = await service.resolve("registration.created", null);
    expect(out.channels).toEqual(["email"]);
  });

  it("throws on unknown notification key", async () => {
    mockRepo();
    await expect(service.resolve("does.not.exist", null)).rejects.toThrow(/Unknown notification/);
  });

  it("subjectOverride precedence — per-org wins over platform", () => {
    const def = NOTIFICATION_CATALOG_BY_KEY["event.reminder"]!;
    const platform = {
      key: "event.reminder",
      organizationId: null,
      enabled: true,
      channels: ["email" as const],
      subjectOverride: { fr: "Rappel platform", en: "Reminder platform", wo: "Fàttaliku platform" },
      updatedAt: new Date().toISOString(),
      updatedBy: "admin-1",
    };
    const perOrg = {
      key: "event.reminder",
      organizationId: "org-1",
      enabled: true,
      channels: ["email" as const],
      subjectOverride: { fr: "Rappel org", en: "Reminder org", wo: "Fàttaliku org" },
      updatedAt: new Date().toISOString(),
      updatedBy: "organizer-1",
    };
    const out = service.merge(def, "org-1", platform, perOrg);
    expect(out.subjectOverride?.fr).toBe("Rappel org");
    expect(out.source.subjectOverride).toBe("organization_override");
  });
});
