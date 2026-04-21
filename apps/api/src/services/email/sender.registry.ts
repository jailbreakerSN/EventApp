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
        // Bulk senders (>5k/day to Gmail, per 2024 rules) MUST expose a
        // one-click unsubscribe. We ship the mailto variant now and upgrade
        // to an RFC 8058 HTTPS endpoint in Phase 3, once signed tokens land.
        // Keeping a backup mailto is still valid under RFC 2369 and is
        // treated as "functional but not one-click" — fine at current volume.
        headers: {
          "List-Unsubscribe": `<mailto:unsubscribe@terangaevent.com>`,
        },
      };
  }
}

function formatFrom(displayName: string, address: string): string {
  return `${displayName} <${address}>`;
}
