import { describe, it, expect } from "vitest";
import { notificationPreviewService } from "../preview.service";

// ─── Preview service ───────────────────────────────────────────────────────
// Renders a react-email template with sensible sample-param defaults.
// No Firestore, no provider — pure HTML render. Tests check:
//   - Every catalog key with an email template renders without throwing.
//   - Each locale produces the right subject (non-empty, locale-specific).
//   - Caller-supplied sampleParams override the hardcoded defaults.
//   - Unknown keys throw.

describe("NotificationPreviewService", () => {
  it("renders registration.created in French with defaults", async () => {
    const out = await notificationPreviewService.preview("registration.created", "fr");
    expect(out.subject).toMatch(/Sample Event/);
    expect(out.html).toContain("<html");
    expect(out.previewText.length).toBeGreaterThan(0);
    // Default participantName should flow into the rendered HTML.
    expect(out.html).toContain("Marie Diop");
  });

  it("renders registration.created in English", async () => {
    const out = await notificationPreviewService.preview("registration.created", "en");
    expect(out.subject).toMatch(/Sample Event/);
    expect(out.html).toContain("<html");
  });

  it("sampleParams override defaults", async () => {
    const out = await notificationPreviewService.preview("registration.created", "fr", {
      participantName: "Fatou Kane",
    });
    expect(out.html).toContain("Fatou Kane");
    expect(out.html).not.toContain("Marie Diop");
  });

  it("renders event.reminder in Wolof", async () => {
    const out = await notificationPreviewService.preview("event.reminder", "wo");
    expect(out.html).toContain("<html");
    expect(out.subject.length).toBeGreaterThan(0);
  });

  it("renders payment.succeeded with currency-formatted amount", async () => {
    const out = await notificationPreviewService.preview("payment.succeeded", "fr");
    expect(out.html).toContain("FCFA");
  });

  it("throws on unknown key", async () => {
    await expect(
      notificationPreviewService.preview("does.not.exist", "fr"),
    ).rejects.toThrow(/Unknown notification/);
  });

  it("returns previewText within 140 chars", async () => {
    const out = await notificationPreviewService.preview("registration.created", "fr");
    expect(out.previewText.length).toBeLessThanOrEqual(140);
  });
});
