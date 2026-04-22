import { describe, it, expect } from "vitest";
import { isChannelAllowedForUser } from "../channel-preferences";

describe("isChannelAllowedForUser", () => {
  it("returns true when preferences is null", () => {
    expect(isChannelAllowedForUser(null, "event.reminder", "email")).toBe(true);
  });

  it("returns true when preferences is undefined", () => {
    expect(isChannelAllowedForUser(undefined, "event.reminder", "email")).toBe(
      true,
    );
  });

  it("returns true when byKey is missing", () => {
    expect(isChannelAllowedForUser({}, "event.reminder", "email")).toBe(true);
  });

  it("returns true when the key has no entry (no opt-out stored)", () => {
    expect(
      isChannelAllowedForUser(
        { byKey: { "other.key": false } },
        "event.reminder",
        "email",
      ),
    ).toBe(true);
  });

  describe("legacy bare boolean", () => {
    it("returns true for `true` on every channel", () => {
      const prefs = { byKey: { "event.reminder": true } };
      expect(isChannelAllowedForUser(prefs, "event.reminder", "email")).toBe(
        true,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "sms")).toBe(
        true,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "push")).toBe(
        true,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "in_app")).toBe(
        true,
      );
    });

    it("returns false for `false` on every channel (legacy opt-out blankets all channels)", () => {
      const prefs = { byKey: { "event.reminder": false } };
      expect(isChannelAllowedForUser(prefs, "event.reminder", "email")).toBe(
        false,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "sms")).toBe(
        false,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "push")).toBe(
        false,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "in_app")).toBe(
        false,
      );
    });
  });

  describe("per-channel object", () => {
    it("returns the explicit per-channel value when set", () => {
      const prefs = {
        byKey: {
          "event.reminder": { email: true, sms: false },
        },
      };
      expect(isChannelAllowedForUser(prefs, "event.reminder", "email")).toBe(
        true,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "sms")).toBe(
        false,
      );
    });

    it("defaults missing channels in the object to true (partial-object case)", () => {
      const prefs = {
        byKey: {
          // User opted out of SMS only. email, push, in_app should remain on.
          "event.reminder": { sms: false },
        },
      };
      expect(isChannelAllowedForUser(prefs, "event.reminder", "sms")).toBe(
        false,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "email")).toBe(
        true,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "push")).toBe(
        true,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "in_app")).toBe(
        true,
      );
    });

    it("honours an all-false per-channel object", () => {
      const prefs = {
        byKey: {
          "event.reminder": {
            email: false,
            sms: false,
            push: false,
            in_app: false,
          },
        },
      };
      expect(isChannelAllowedForUser(prefs, "event.reminder", "email")).toBe(
        false,
      );
      expect(isChannelAllowedForUser(prefs, "event.reminder", "in_app")).toBe(
        false,
      );
    });

    it("scoping is per-key: opting out of event.reminder SMS does not affect registration.created SMS", () => {
      const prefs = {
        byKey: {
          "event.reminder": { sms: false },
        },
      };
      expect(
        isChannelAllowedForUser(prefs, "registration.created", "sms"),
      ).toBe(true);
      expect(isChannelAllowedForUser(prefs, "event.reminder", "sms")).toBe(
        false,
      );
    });
  });
});
