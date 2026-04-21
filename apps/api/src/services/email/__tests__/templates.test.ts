import { describe, it, expect } from "vitest";
import {
  buildRegistrationEmail,
  buildPaymentReceiptEmail,
  buildWelcomeEmail,
  buildEventCancelledEmail,
} from "../templates";

// End-to-end render tests — exercise react-email + i18n against real JSX.
// We assert on the rendered output so the tests catch:
//   * broken JSX / unsupported component imports
//   * missing i18n keys (which would show up as `undefined` in the HTML)
//   * locale routing (French default, English/Wolof overrides)

describe("email templates — localized render", () => {
  const params = {
    participantName: "Aminata Diop",
    eventTitle: "Dakar Tech Summit",
    eventDate: "15 mai 2026, 10:00",
    eventLocation: "CICAD, Diamniadio",
    ticketName: "Billet Standard",
    registrationId: "reg-42",
  };

  it("renders registration confirmation in French by default", async () => {
    const { subject, html, text } = await buildRegistrationEmail(params);
    expect(subject).toContain("Inscription confirmée");
    expect(subject).toContain("Dakar Tech Summit");
    expect(html).toContain("Aminata Diop");
    expect(html).toContain("Inscription confirmée");
    expect(html).toContain("Billet Standard");
    expect(text).toContain("Aminata Diop");
    // Never leak raw placeholders.
    expect(html).not.toContain("undefined");
    expect(text).not.toContain("undefined");
  });

  it("renders registration confirmation in English when locale=en", async () => {
    const { subject, html } = await buildRegistrationEmail({ ...params, locale: "en" });
    expect(subject).toContain("Registration confirmed");
    expect(html).toContain("Hello Aminata Diop");
    expect(html).not.toContain("Bonjour");
  });

  it("renders registration confirmation in Wolof when locale=wo", async () => {
    const { subject, html } = await buildRegistrationEmail({ ...params, locale: "wo" });
    expect(subject).toContain("dafa dëgër");
    expect(html).toContain("Asalaa maalekum");
  });

  it("renders a payment receipt with amount + reference visible", async () => {
    const { subject, html, text } = await buildPaymentReceiptEmail({
      participantName: "Ibrahima Fall",
      amount: "25 000 FCFA",
      eventTitle: "Afrobytes 2026",
      receiptId: "pay_abc123",
      paymentDate: "20 avril 2026",
    });
    expect(subject).toContain("25 000 FCFA");
    expect(html).toContain("25 000 FCFA");
    expect(html).toContain("pay_abc123");
    expect(text).toContain("Afrobytes 2026");
  });

  it("renders welcome newsletter with unsubscribe footer (marketing)", async () => {
    const { html, text } = await buildWelcomeEmail({ email: "hello@example.com" });
    // Visible footer backup — the RFC 8058 header is set at the provider layer.
    expect(html).toContain("désinscrire");
    expect(text).toContain("Teranga");
  });

  it("falls back to French for unknown locale values", async () => {
    const { subject } = await buildEventCancelledEmail({
      participantName: "Test",
      eventTitle: "Annulé",
      eventDate: "10 mai",
      // intentionally forcing an unsupported locale at runtime — this
      // mirrors legacy UserProfile docs that never filled in the field
      locale: "es" as unknown as "fr",
    });
    expect(subject).toContain("Événement annulé");
  });
});
