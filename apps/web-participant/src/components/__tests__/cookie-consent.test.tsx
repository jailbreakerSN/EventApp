/**
 * Pins Wave 10 / W10-P6 / L4 — cookie consent banner contract.
 *
 * What we pin
 * ───────────
 *   - Renders nothing on the server (mounted=false guard).
 *   - Renders the banner when localStorage is empty.
 *   - Persists "accepted" + dispatches the CustomEvent on Accept click.
 *   - Persists "rejected" on Reject click.
 *   - Stays hidden once a choice is persisted.
 *   - hasCookieConsent() reflects the persisted value.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { CookieConsentBanner, hasCookieConsent } from "../cookie-consent";

const STORAGE_KEY = "teranga_cookie_consent_v1";

function renderBanner() {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <CookieConsentBanner />
    </NextIntlClientProvider>,
  );
}

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders when no choice is persisted", () => {
    renderBanner();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accepter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refuser/i })).toBeInTheDocument();
  });

  it("persists 'accepted' + dispatches the consent event on Accept", () => {
    const listener = vi.fn();
    window.addEventListener("teranga:cookie-consent", listener);

    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /accepter/i }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("accepted");
    expect(hasCookieConsent()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent<string>;
    expect(event.detail).toBe("accepted");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    window.removeEventListener("teranga:cookie-consent", listener);
  });

  it("persists 'rejected' on Reject", () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /refuser/i }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("rejected");
    expect(hasCookieConsent()).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays hidden when 'accepted' is already persisted", () => {
    window.localStorage.setItem(STORAGE_KEY, "accepted");
    renderBanner();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays hidden when 'rejected' is already persisted", () => {
    window.localStorage.setItem(STORAGE_KEY, "rejected");
    renderBanner();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the privacy link", () => {
    renderBanner();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/privacy");
  });
});

describe("hasCookieConsent", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns false when nothing is persisted", () => {
    expect(hasCookieConsent()).toBe(false);
  });

  it("returns true only on 'accepted'", () => {
    window.localStorage.setItem(STORAGE_KEY, "accepted");
    expect(hasCookieConsent()).toBe(true);
  });

  it("returns false on 'rejected'", () => {
    window.localStorage.setItem(STORAGE_KEY, "rejected");
    expect(hasCookieConsent()).toBe(false);
  });
});
