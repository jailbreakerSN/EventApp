import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATALOG_BY_KEY,
  NotificationDefinitionSchema,
  NotificationSettingSchema,
  NotificationRecipientSchema,
  assertCatalogIntegrity,
  isKnownNotificationKey,
  type NotificationDefinition,
} from "../notification-catalog";

// ─── Catalog integrity ─────────────────────────────────────────────────────
// Guards the shape invariants every dispatcher / admin-UI / preferences-UI
// consumer relies on. If any of these fail, the fix is always in the
// catalog definition, never in the test.

describe("notification catalog", () => {
  it("every catalog entry parses against NotificationDefinitionSchema", () => {
    for (const def of NOTIFICATION_CATALOG) {
      const parsed = NotificationDefinitionSchema.safeParse(def);
      expect(parsed.success, `${def.key}: ${JSON.stringify(parsed.error?.issues ?? [])}`).toBe(
        true,
      );
    }
  });

  it("has at least one entry", () => {
    expect(NOTIFICATION_CATALOG.length).toBeGreaterThan(0);
  });

  it("NOTIFICATION_CATALOG_BY_KEY indexes every entry by key", () => {
    expect(Object.keys(NOTIFICATION_CATALOG_BY_KEY)).toHaveLength(NOTIFICATION_CATALOG.length);
    for (const def of NOTIFICATION_CATALOG) {
      expect(NOTIFICATION_CATALOG_BY_KEY[def.key]).toBe(def);
    }
  });

  it("every key is unique", () => {
    const keys = NOTIFICATION_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("defaultChannels is always a subset of supportedChannels", () => {
    for (const def of NOTIFICATION_CATALOG) {
      for (const channel of def.defaultChannels) {
        expect(def.supportedChannels).toContain(channel);
      }
    }
  });

  it("every supportedChannel has a matching template id", () => {
    for (const def of NOTIFICATION_CATALOG) {
      for (const channel of def.supportedChannels) {
        expect(def.templates[channel]).toBeTruthy();
      }
    }
  });

  it("auth + billing categories are non-opt-out-able", () => {
    for (const def of NOTIFICATION_CATALOG) {
      if (def.category === "auth" || def.category === "billing") {
        expect(def.userOptOutAllowed).toBe(false);
      }
    }
  });

  it("every displayName and description has fr/en/wo", () => {
    for (const def of NOTIFICATION_CATALOG) {
      for (const locale of ["fr", "en", "wo"] as const) {
        expect(def.displayName[locale], `${def.key}.displayName.${locale}`).toBeTruthy();
        expect(def.description[locale], `${def.key}.description.${locale}`).toBeTruthy();
      }
    }
  });

  it("isKnownNotificationKey narrows correctly", () => {
    expect(isKnownNotificationKey("registration.created")).toBe(true);
    expect(isKnownNotificationKey("not.a.real.key")).toBe(false);
  });
});

// ─── assertCatalogIntegrity ────────────────────────────────────────────────
// Same invariants as above but through the runtime guard. Ensures the
// import-time call inside notification-catalog.ts doesn't regress.

describe("assertCatalogIntegrity", () => {
  it("accepts the shipped catalog", () => {
    expect(() => assertCatalogIntegrity()).not.toThrow();
  });

  it("rejects a duplicate key", () => {
    const dup: NotificationDefinition[] = [
      ...NOTIFICATION_CATALOG.slice(0, 2),
      NOTIFICATION_CATALOG[0]!,
    ];
    expect(() => assertCatalogIntegrity(dup)).toThrow(/Duplicate notification key/);
  });

  it("rejects a default channel missing from supportedChannels", () => {
    const bad: NotificationDefinition[] = [
      {
        ...NOTIFICATION_CATALOG[0]!,
        supportedChannels: ["email"],
        defaultChannels: ["email", "sms"],
      },
    ];
    expect(() => assertCatalogIntegrity(bad)).toThrow(
      /default channel "sms" not in supportedChannels/,
    );
  });

  it("rejects a missing template id for a supportedChannel", () => {
    const bad: NotificationDefinition[] = [
      {
        ...NOTIFICATION_CATALOG[0]!,
        supportedChannels: ["email", "sms"],
        defaultChannels: ["email"],
        templates: { email: "Foo" },
      },
    ];
    expect(() => assertCatalogIntegrity(bad)).toThrow(/missing templates\["sms"\]/);
  });

  it("rejects auth / billing notifications that allow user opt-out", () => {
    const bad: NotificationDefinition[] = [
      {
        ...NOTIFICATION_CATALOG[0]!,
        category: "auth",
        userOptOutAllowed: true,
      },
    ];
    expect(() => assertCatalogIntegrity(bad)).toThrow(/must have userOptOutAllowed=false/);
  });
});

// ─── Schema parse round-trips ──────────────────────────────────────────────

describe("NotificationSettingSchema", () => {
  it("parses a complete setting", () => {
    const setting = {
      key: "registration.created",
      enabled: false,
      channels: ["email"],
      subjectOverride: { fr: "Test", en: "Test", wo: "Test" },
      updatedAt: "2026-04-21T12:00:00.000Z",
      updatedBy: "user-123",
    };
    const parsed = NotificationSettingSchema.safeParse(setting);
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid channel", () => {
    const bad = {
      key: "registration.created",
      enabled: true,
      channels: ["telepathy"],
      updatedAt: "2026-04-21T12:00:00.000Z",
      updatedBy: "user-123",
    };
    expect(NotificationSettingSchema.safeParse(bad).success).toBe(false);
  });
});

describe("NotificationRecipientSchema", () => {
  it("parses a user-scoped recipient", () => {
    const parsed = NotificationRecipientSchema.safeParse({
      userId: "u1",
      preferredLocale: "fr",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses an email-only recipient (invitee pattern)", () => {
    const parsed = NotificationRecipientSchema.safeParse({
      email: "invitee@example.com",
      preferredLocale: "en",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown locale", () => {
    const parsed = NotificationRecipientSchema.safeParse({
      userId: "u1",
      preferredLocale: "xx",
    });
    expect(parsed.success).toBe(false);
  });
});
