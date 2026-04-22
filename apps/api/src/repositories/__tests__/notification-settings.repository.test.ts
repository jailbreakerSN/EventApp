import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Firestore fake ────────────────────────────────────────────────────────
// Minimal in-memory collection keyed by doc id so we can exercise the
// upsert / findByKey / listAll surface end-to-end without booting Firestore.
// vi.hoisted because vi.mock is hoisted above top-level consts and would
// otherwise see `storage` as undefined.

const { storage } = vi.hoisted(() => ({
  storage: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/config/firebase", () => {
  const fakeCollection = {
    doc: (id: string) => ({
      get: async () => {
        const data = storage.get(id);
        return {
          exists: data !== undefined,
          data: () => data,
        };
      },
      set: async (payload: Record<string, unknown>) => {
        storage.set(id, payload);
      },
    }),
    get: async () => ({
      docs: Array.from(storage.entries()).map(([id, data]) => ({
        id,
        data: () => data,
      })),
    }),
  };
  return {
    db: {
      collection: () => fakeCollection,
    },
    COLLECTIONS: {
      NOTIFICATION_SETTINGS: "notificationSettings",
    },
  };
});

import { notificationSettingsRepository } from "../notification-settings.repository";

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("NotificationSettingsRepository", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it("findByKey returns null when no override exists", async () => {
    const result = await notificationSettingsRepository.findByKey("registration.created");
    expect(result).toBeNull();
  });

  it("upsert writes the full document, findByKey reads it back", async () => {
    const setting = {
      key: "registration.created",
      enabled: false,
      channels: ["email" as const],
      updatedAt: "2026-04-21T00:00:00.000Z",
      updatedBy: "admin-u-1",
    };

    await notificationSettingsRepository.upsert(setting);
    const result = await notificationSettingsRepository.findByKey("registration.created");

    // Phase 2.4 — the repo now also surfaces `organizationId: null` for
    // platform-wide settings. Assert the pre-existing fields plus the
    // new one rather than structural equality.
    expect(result?.key).toBe("registration.created");
    expect(result?.enabled).toBe(false);
    expect(result?.channels).toEqual(["email"]);
    expect(result?.updatedBy).toBe("admin-u-1");
    expect(result?.organizationId ?? null).toBeNull();
  });

  it("upsert preserves subjectOverride when provided", async () => {
    const setting = {
      key: "event.reminder",
      enabled: true,
      channels: ["email" as const],
      subjectOverride: { fr: "Rappel", en: "Reminder", wo: "Fàttaliku" },
      updatedAt: "2026-04-21T00:00:00.000Z",
      updatedBy: "admin-u-1",
    };

    await notificationSettingsRepository.upsert(setting);
    const result = await notificationSettingsRepository.findByKey("event.reminder");

    expect(result?.subjectOverride).toEqual(setting.subjectOverride);
  });

  it("listAll returns every stored override", async () => {
    await notificationSettingsRepository.upsert({
      key: "a.key",
      enabled: true,
      channels: ["email"],
      updatedAt: "2026-04-21T00:00:00.000Z",
      updatedBy: "admin-u-1",
    });
    await notificationSettingsRepository.upsert({
      key: "b.key",
      enabled: false,
      channels: [],
      updatedAt: "2026-04-21T00:01:00.000Z",
      updatedBy: "admin-u-2",
    });

    const all = await notificationSettingsRepository.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.key).sort()).toEqual(["a.key", "b.key"]);
  });

  it("findByKey defaults enabled to true when the stored doc lacks the field", async () => {
    // Simulate a partially-migrated doc missing `enabled`. The dispatcher
    // treats absence as "enabled" (fail open), not "disabled" — silently
    // dropping all notifications because a field was absent would be worse.
    storage.set("legacy.key", {
      key: "legacy.key",
      channels: ["email"],
      updatedAt: "2026-04-21T00:00:00.000Z",
      updatedBy: "admin-u-1",
    });

    const result = await notificationSettingsRepository.findByKey("legacy.key");
    expect(result?.enabled).toBe(true);
  });

  it("findByKey returns null on schema-invalid docs (corrupt / manual edit)", async () => {
    // `enabled: "false"` (string, not boolean) must be rejected rather
    // than silently treated as truthy. See Phase 1 security review P1-2.
    storage.set("bad.key", {
      key: "bad.key",
      enabled: "false",
      channels: ["email"],
      updatedAt: "2026-04-21T00:00:00.000Z",
      updatedBy: "admin-u-1",
    });

    const result = await notificationSettingsRepository.findByKey("bad.key");
    expect(result).toBeNull();
  });

  it("findByKey returns null when channels contains an unknown value", async () => {
    storage.set("bad.channel.key", {
      key: "bad.channel.key",
      enabled: true,
      channels: ["telepathy"],
      updatedAt: "2026-04-21T00:00:00.000Z",
      updatedBy: "admin-u-1",
    });

    const result = await notificationSettingsRepository.findByKey("bad.channel.key");
    expect(result).toBeNull();
  });
});
