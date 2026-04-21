import { config } from "@/config";

// ─── Landing-page renderer (shared HTTP HTML responses) ──────────────────
//
// The API serves a handful of plain-HTML success/error pages that users
// land on after clicking a link in one of our emails:
//   - /v1/newsletter/confirm  (double-opt-in confirmation)
//   - /v1/notifications/unsubscribe  (RFC 8058 visible link)
//
// Before this refactor each route had its own near-identical `renderX`
// helper with the same card shell + brand header + escape logic. They
// diverged over time (different footer text, different escape
// helpers) and none offered a way back into the product — a click on
// a confirmation email left the user stranded on a tab titled
// "Inscription confirmée" with no navigation.
//
// One shared renderer fixes both problems:
//   1. Single styling source of truth → consistent Teranga look.
//   2. Built-in CTA slot → every landing page can point the user
//      back into the participant web app, which is where they
//      actually want to go next.
//
// Kept deliberately minimal (no JS, no external assets) so it stays
// safe under strict CSP and loads instantly even on slow 3G in
// Dakar. Colours mirror docs/design-system tokens.

export interface LandingPageCta {
  /** Visible button/link text. Must already be localised by the caller. */
  label: string;
  /** Absolute URL. Usually built from config/public-urls helpers. */
  href: string;
  /**
   * `primary` renders as the filled gold button (one per page, max).
   * `secondary` renders as a plain text link below the primary.
   * Defaults to `secondary` when omitted.
   */
  variant?: "primary" | "secondary";
}

export interface LandingPageOptions {
  kind: "success" | "error";
  /** Card heading — already localised. */
  headingText: string;
  /** Body paragraph — already localised. Rendered with HTML escaping. */
  message: string;
  /**
   * Optional CTAs rendered below the message. Order is respected. At
   * most one entry should use `variant: "primary"` for visual focus.
   * Pass an empty array (or omit) for a bare informational page.
   */
  ctas?: LandingPageCta[];
  /** BCP-47 language for `<html lang>`. Defaults to `fr`. */
  lang?: "fr" | "en" | "wo";
  /** `<title>` text (already includes the brand prefix). */
  title?: string;
}

const PAGE_BG = "#F5F5F0";
const CARD_BG = "#FFFFFF";
const BRAND_NAVY = "#1A1A2E";
const BRAND_GOLD = "#D4A843";
const TEXT_PRIMARY = "#1A1A2E";
const TEXT_MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const ACCENT_SUCCESS = "#16A34A";
const ACCENT_ERROR = "#DC2626";

export function renderLandingPage(opts: LandingPageOptions): string {
  const lang = opts.lang ?? "fr";
  const title = opts.title ?? `Teranga Events — ${opts.headingText}`;
  const accent = opts.kind === "success" ? ACCENT_SUCCESS : ACCENT_ERROR;
  const emoji = opts.kind === "success" ? "✓" : "⚠";
  const safeHeading = escapeHtml(opts.headingText);
  const safeMessage = escapeHtml(opts.message);
  const ctaHtml = renderCtas(opts.ctas ?? []);

  // Footer tagline stays French — it's the brand tagline, not UI copy,
  // and we don't carry i18n strings down this far yet. Once the API
  // pulls in the email i18n Dictionary for its HTTP surfaces too
  // (future refactor), this becomes `dict.brand.footer`.
  const footer = "Teranga Events — La plateforme événementielle du Sénégal";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; background: ${PAGE_BG}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: ${TEXT_PRIMARY}; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 40px 24px; }
    .card { background: ${CARD_BG}; border: 1px solid ${BORDER}; border-radius: 12px; overflow: hidden; }
    .header { background: ${BRAND_NAVY}; color: ${BRAND_GOLD}; padding: 24px; text-align: center; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
    .body { padding: 32px 24px; text-align: center; }
    .emoji { font-size: 40px; color: ${accent}; margin-bottom: 12px; line-height: 1; }
    .heading { font-size: 20px; font-weight: 600; margin: 0 0 12px 0; color: ${TEXT_PRIMARY}; }
    .message { margin: 0; color: #4B5563; line-height: 1.5; }
    .ctas { margin-top: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .cta-primary { display: inline-block; background: ${BRAND_GOLD}; color: #FFFFFF; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; }
    .cta-primary:hover { filter: brightness(0.95); }
    .cta-secondary { color: ${TEXT_MUTED}; text-decoration: underline; font-size: 14px; }
    .cta-secondary:hover { color: ${TEXT_PRIMARY}; }
    .footer { padding: 16px 24px 24px; color: #9CA3AF; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">Teranga</div>
      <div class="body">
        <div class="emoji" aria-hidden="true">${emoji}</div>
        <h1 class="heading">${safeHeading}</h1>
        <p class="message">${safeMessage}</p>
${ctaHtml}      </div>
      <div class="footer">${escapeHtml(footer)}</div>
    </div>
  </div>
</body>
</html>`;
}

function renderCtas(ctas: readonly LandingPageCta[]): string {
  if (ctas.length === 0) return "";
  const items = ctas
    .map((cta) => {
      const cls = cta.variant === "primary" ? "cta-primary" : "cta-secondary";
      return `          <a class="${cls}" href="${escapeAttribute(cta.href)}">${escapeHtml(
        cta.label,
      )}</a>`;
    })
    .join("\n");
  return `        <div class="ctas">\n${items}\n        </div>\n`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape a URL for safe inclusion in an href attribute. We only ever pass
 * URLs built from config (via config/public-urls), so this is defence-in-
 * depth against a future refactor that splices user input into a CTA href
 * without first running it through a proper URL parser.
 *
 * Critically: rejects any value that isn't an absolute http/https URL.
 * A javascript: URL slipping into an href attribute would be live XSS
 * regardless of attribute-value escaping.
 */
function escapeAttribute(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "#";
  } catch {
    return "#";
  }
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ─── Convenience: the canonical "back to product" CTA ─────────────────────
//
// Almost every landing page wants the same "return to Teranga" button.
// Centralising it here means a future domain change (participant URL
// moves) ripples through every consumer automatically via config.

export function backToParticipantCta(label: string): LandingPageCta {
  return {
    label,
    href: config.PARTICIPANT_WEB_URL,
    variant: "primary",
  };
}
