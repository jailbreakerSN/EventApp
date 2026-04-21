import { type EmailCategory } from "@teranga/shared-types";
import { config } from "@/config";

// ─── Sender Registry ────────────────────────────────────────────────────────
// Maps an EmailCategory to the concrete From/Reply-To pair used by the Resend
// (or fallback) provider. Categories live in shared-types; the addresses
// themselves are env-driven so staging/prod can differ without code changes.
//
// Design: one sender per category, not one per template. Fewer, well-named
// senders are easier to monitor (Resend dashboard filters by tag), protect
// domain reputation, and build user trust — they learn `billing@` means
// invoices, `no-reply@` means transactional, etc.
//
// Reply-To is always a real inbox so users who hit reply don't hit a wall.
// Resend is outbound-only; MX for those addresses must point at an
// actual mailbox provider (Google Workspace, Fastmail, etc.).

export interface SenderConfig {
  /** Pre-formatted "Name <address>" string ready for the provider. */
  from: string;
  /** Plain address — providers wrap it in their own shape. */
  replyTo: string;
  /** Default Resend tags. Providers that support tags will forward these. */
  tags: { name: string; value: string }[];
  /**
   * Additional RFC 5322 headers stamped on every send in this category.
   * Today we emit List-Unsubscribe for `marketing` so Gmail/Yahoo's
   * bulk-sender rules are satisfied. Phase 3 will swap the mailto for a
   * signed HTTPS URL + RFC 8058 one-click POST.
   */
  headers?: Record<string, string>;
}

export function resolveSender(category: EmailCategory): SenderConfig {
  const name = config.RESEND_FROM_NAME;

  switch (category) {
    case "auth":
      return {
        from: formatFrom(name, config.RESEND_FROM_NOREPLY),
        replyTo: config.RESEND_REPLY_TO_SUPPORT,
        tags: [{ name: "category", value: "auth" }],
      };

    case "transactional":
      return {
        from: formatFrom(name, config.RESEND_FROM_NOREPLY),
        replyTo: config.RESEND_REPLY_TO_SUPPORT,
        tags: [{ name: "category", value: "transactional" }],
      };

    case "organizational":
      return {
        from: formatFrom(name, config.RESEND_FROM_HELLO),
        replyTo: config.RESEND_REPLY_TO_SUPPORT,
        tags: [{ name: "category", value: "organizational" }],
      };

    case "billing":
      return {
        from: formatFrom(name, config.RESEND_FROM_BILLING),
        replyTo: config.RESEND_REPLY_TO_BILLING,
        tags: [{ name: "category", value: "billing" }],
      };

    case "marketing":
      return {
        from: formatFrom(name, config.RESEND_FROM_NEWS),
        replyTo: config.RESEND_REPLY_TO_CONTACT,
        tags: [{ name: "category", value: "marketing" }],
        // No manual List-Unsubscribe header here on purpose. Marketing sends
        // go through POST /broadcasts (see newsletter.service); Resend
        // injects the one-click RFC 8058 List-Unsubscribe header + hosts the
        // unsubscribe endpoint against the Audience automatically. Adding a
        // mailto: backup would point at a no-op inbox and actively confuse
        // mailbox providers. If a future marketing path ever needs raw
        // /emails — which would be unusual — we'd revisit.
      };
  }
}

function formatFrom(displayName: string, address: string): string {
  return `${displayName} <${address}>`;
}
