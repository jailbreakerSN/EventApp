"use client";

/**
 * Wave 10 / W10-P6 / L4 — Cookie consent banner.
 *
 * Senegal Loi 2008-12 + GDPR alignment: analytics + Sentry are
 * "non-essential" trackers and require explicit user consent before
 * loading. This banner blocks GA4 and Sentry session-replay (when
 * eventually enabled) until the user clicks Accept.
 *
 * The banner is intentionally lightweight (no TCF v2, no IAB) — the
 * Senegalese market doesn't need a full IAB framework, and a
 * lighter-weight in-house gate stays auditable + francophone-first.
 *
 * Persistence
 * ───────────
 * The user's choice is persisted in `localStorage` under the key
 * `teranga_cookie_consent_v1`. Values:
 *   - "accepted" — analytics + observability allowed
 *   - "rejected" — strictly necessary cookies only
 *   - missing → banner visible, all non-essential trackers blocked
 *
 * The choice is also broadcast to the rest of the app via a
 * `CustomEvent("teranga:cookie-consent")` on `window` so consumers
 * (the analytics initializer in particular) can lazily load on
 * accept without a page reload.
 *
 * Accessibility
 * ─────────────
 *   - role="dialog", aria-labelledby + aria-describedby pin a screen
 *     reader to the consent copy.
 *   - Buttons are keyboard-reachable (Tab order: Accept, Reject).
 *   - High-contrast palette per the Teranga design tokens (bg neutral,
 *     primary CTA on teranga-navy).
 *
 * The banner does NOT block page rendering — it overlays the bottom
 * of the viewport so the participant funnel keeps working without
 * interaction. The consent gate is the analytics/Sentry init code,
 * not the banner UI.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "teranga_cookie_consent_v1";
type ConsentValue = "accepted" | "rejected" | null;

function readConsent(): ConsentValue {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "accepted" || v === "rejected") return v;
  return null;
}

function writeConsent(value: "accepted" | "rejected"): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent("teranga:cookie-consent", { detail: value }));
}

/**
 * Helper for analytics / Sentry initializers — read once at module
 * boot. The consent banner re-broadcasts on click; consumers should
 * also subscribe to `window.addEventListener("teranga:cookie-consent",
 * ...)` to lazily init on accept.
 */
export function hasCookieConsent(): boolean {
  return readConsent() === "accepted";
}

export function CookieConsentBanner() {
  const t = useTranslations("cookieConsent");
  const [consent, setConsent] = useState<ConsentValue>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConsent(readConsent());
  }, []);

  // Avoid hydration mismatch — render nothing on the server.
  if (!mounted) return null;
  // User has decided — banner stays out of the way.
  if (consent !== null) return null;

  const accept = () => {
    writeConsent("accepted");
    setConsent("accepted");
  };
  const reject = () => {
    writeConsent("rejected");
    setConsent("rejected");
  };

  return (
    <div
      role="dialog"
      aria-labelledby="teranga-consent-title"
      aria-describedby="teranga-consent-body"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white px-4 py-4 shadow-xl sm:px-6 sm:py-5"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <h2 id="teranga-consent-title" className="text-sm font-semibold text-neutral-900">
            {t("title")}
          </h2>
          <p id="teranga-consent-body" className="mt-1 text-sm text-neutral-700">
            {t("body")}{" "}
            <a
              href="/privacy"
              className="font-medium text-teranga-navy underline underline-offset-2 hover:text-teranga-navy/80"
            >
              {t("privacyLink")}
            </a>
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-shrink-0">
          <button
            type="button"
            onClick={reject}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-teranga-navy focus:ring-offset-2"
          >
            {t("reject")}
          </button>
          <button
            type="button"
            onClick={accept}
            className="rounded-md bg-teranga-navy px-4 py-2 text-sm font-medium text-white hover:bg-teranga-navy/90 focus:outline-none focus:ring-2 focus:ring-teranga-navy focus:ring-offset-2"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
