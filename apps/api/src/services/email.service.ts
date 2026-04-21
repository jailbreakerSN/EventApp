import { type EmailCategory } from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { getEmailProvider } from "@/providers/index";
import { type EmailParams, type BulkEmailResult } from "@/providers/email-provider.interface";
import { userRepository } from "@/repositories/user.repository";
import { resolveSender } from "./email/sender.registry";
import { asLocale, type Locale } from "./email/i18n";
import { type RenderedEmail } from "./email/render";
import {
  buildRegistrationEmail,
  buildRegistrationApprovedEmail,
  buildBadgeReadyEmail,
  buildEventCancelledEmail,
  buildEventReminderEmail,
  buildWelcomeEmail,
  buildPaymentReceiptEmail,
  buildNewsletterConfirmationEmail,
  type RegistrationConfirmationParams,
  type RegistrationApprovedParams,
  type BadgeReadyParams,
  type EventCancelledParams,
  type EventReminderParams,
  type PaymentReceiptParams,
} from "./email/templates";

// ─── Types ──────────────────────────────────────────────────────────────────

interface NotificationPrefs {
  // Channel toggles. `email` is the legacy kill-switch — per-category
  // fields (below) take precedence when set. Kept so pre-3c.3 docs still
  // work and so the UI can offer a single "turn off all email" action.
  email: boolean;
  sms: boolean;
  push: boolean;
  // Per-category (Phase 3c.3). `undefined` means "fall back to `email`".
  emailTransactional?: boolean;
  emailOrganizational?: boolean;
  emailMarketing?: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = { email: true, sms: true, push: true };
const DEFAULT_LOCALE: Locale = "fr";

// Map each non-mandatory EmailCategory to the preference field that gates
// it. auth + billing are mandatory (MANDATORY_CATEGORIES below) so they
// never consult prefs.
const CATEGORY_PREF_FIELD: Record<
  Exclude<EmailCategory, "auth" | "billing">,
  "emailTransactional" | "emailOrganizational" | "emailMarketing"
> = {
  transactional: "emailTransactional",
  organizational: "emailOrganizational",
  marketing: "emailMarketing",
};

interface SendOptions {
  /** Additional tags merged with the category's default tags for Resend analytics. */
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
}

// Categories that MUST send regardless of the user's email preference —
// they are legally or contractually mandatory (security records, financial
// receipts). Marketing prefs don't apply. When the per-category preference
// model lands in Phase 3, these stay locked-on and the UI simply hides the
// toggle for them.
const MANDATORY_CATEGORIES: ReadonlySet<EmailCategory> = new Set(["auth", "billing"]);

/**
 * Lazily renders an email for a given locale. Accepting a factory (rather
 * than a pre-rendered `RenderedEmail`) lets `sendToUser` use the user's
 * `preferredLanguage` without the caller having to fetch the user first.
 */
export type EmailTemplateFactory = (locale: Locale) => Promise<RenderedEmail>;

// ─── Email Service ──────────────────────────────────────────────────────────
// Centralized service for all email sending. Handles:
// - User notification preference checking + mandatory-category bypass
// - Locale resolution (user.preferredLanguage) + template rendering
// - Provider delegation (Resend / SendGrid / Mock)
// - Category → From/Reply-To/headers routing via the sender registry
// All methods are fire-and-forget safe — errors are logged, never thrown.
//
// Every public send method requires an EmailCategory. This is type-enforced
// so callers cannot accidentally fall back to the legacy single sender.

export class EmailService {
  /**
   * Check whether an email is on the platform-wide suppression list.
   *
   * Written by the resendWebhook Cloud Function on `email.bounced` and
   * `email.complained` — see apps/functions/src/triggers/resend/
   * resend-webhook.https.ts. Doc id is the lowercased address, presence
   * alone means suppressed.
   *
   * Suppression applies to EVERY category, including mandatory (auth +
   * billing): a hard-bounced address will never accept mail, so Resend
   * would refuse anyway, and retrying hurts sender reputation. For
   * complaints, legal jurisdictions vary but industry practice is to
   * honor the complaint across the board.
   *
   * Fails open — if Firestore is unavailable we proceed with the send
   * rather than blocking legitimate emails. The Cloud Run SLA covers
   * this; a transient suppression read failure is a worse outcome than
   * a transient Resend read failure (which would swallow the send
   * anyway via the provider's retry budget).
   */
  async isSuppressed(email: string): Promise<boolean> {
    try {
      const snap = await db
        .collection(COLLECTIONS.EMAIL_SUPPRESSIONS)
        .doc(email.toLowerCase())
        .get();
      return snap.exists;
    } catch {
      return false;
    }
  }

  /**
   * Get a user's notification preferences. Returns defaults if no doc exists.
   *
   * Per-category fields (emailTransactional / emailOrganizational /
   * emailMarketing) are returned verbatim so `isEmailCategoryEnabled`
   * can distinguish "not set" (fall back to legacy `email`) from
   * "explicitly set to false" (honor the user's choice).
   */
  async getPreferences(userId: string): Promise<NotificationPrefs> {
    try {
      const doc = await db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(userId).get();
      if (!doc.exists) return DEFAULT_PREFS;
      const data = doc.data()!;
      return {
        email: data.email ?? true,
        sms: data.sms ?? true,
        push: data.push ?? true,
        emailTransactional: data.emailTransactional,
        emailOrganizational: data.emailOrganizational,
        emailMarketing: data.emailMarketing,
      };
    } catch {
      return DEFAULT_PREFS;
    }
  }

  /**
   * Resolve the effective "is this email category enabled" flag.
   *
   * Precedence:
   *   1. Mandatory categories (auth, billing) are always enabled —
   *      short-circuited in `sendToUser` before this helper runs.
   *   2. Explicit per-category field (`emailTransactional` etc.) wins
   *      when set — user toggled it deliberately in Settings.
   *   3. Legacy `email` aggregate kicks in when per-category is
   *      undefined — pre-3c.3 docs and "kill-switch" behavior.
   *
   * Exported as a class method (rather than free function) so tests
   * can exercise it in isolation without mocking Firestore.
   */
  isEmailCategoryEnabled(prefs: NotificationPrefs, category: EmailCategory): boolean {
    if (MANDATORY_CATEGORIES.has(category)) return true;
    const field = CATEGORY_PREF_FIELD[category as Exclude<EmailCategory, "auth" | "billing">];
    const explicit = prefs[field];
    if (explicit !== undefined) return explicit;
    // Back-compat: legacy docs + kill-switch semantics — `email: false`
    // means "no email at all (for non-mandatory categories)".
    return prefs.email;
  }

  /**
   * Send an email to a user, routed by category and localized to the user's
   * `preferredLanguage` (fallback: French).
   *
   * Preference check: skipped for MANDATORY_CATEGORIES (auth, billing) —
   * users cannot opt out of security and financial records. For every
   * other category, the per-category toggle (Phase 3c.3) gates the
   * send, with a fallback to the legacy `email` aggregate for pre-3c.3
   * preference docs. See `isEmailCategoryEnabled` for precedence.
   *
   * Always returns silently if the user has no email address.
   */
  async sendToUser(
    userId: string,
    template: EmailTemplateFactory,
    category: EmailCategory,
    options?: SendOptions,
  ): Promise<void> {
    try {
      const isMandatory = MANDATORY_CATEGORIES.has(category);

      const [prefs, user] = await Promise.all([
        isMandatory ? Promise.resolve(null) : this.getPreferences(userId),
        userRepository.findById(userId),
      ]);

      if (!isMandatory && prefs && !this.isEmailCategoryEnabled(prefs, category)) return;
      if (!user?.email) return;

      // Platform-wide suppression gate — hard bounces + spam complaints
      // (written by the resendWebhook Cloud Function) apply to every
      // category including mandatory ones. Sending to a known-bouncing
      // address won't deliver anyway and degrades domain reputation.
      if (await this.isSuppressed(user.email)) {
        logSuppressedSkip(user.email, category, "sendToUser", userId);
        return;
      }

      const locale = asLocale(user.preferredLanguage) ?? DEFAULT_LOCALE;
      const email = await template(locale);

      const provider = getEmailProvider();
      await provider.send(this.buildParams(user.email, email, category, options));
    } catch {
      // Fire-and-forget: email failure must not block
    }
  }

  /**
   * Send a pre-rendered email directly to an address (no user lookup or
   * preference check). Used for newsletter subscribers, invites, and other
   * non-user recipients. Callers supply the locale at render time.
   */
  async sendDirect(
    to: string,
    email: RenderedEmail,
    category: EmailCategory,
    options?: SendOptions,
  ): Promise<void> {
    try {
      // Suppression gate applies here too — `sendDirect` is used for
      // newsletter welcome + any future non-user flows, and we don't
      // want to re-send to an address that bounced or complained.
      if (await this.isSuppressed(to)) {
        logSuppressedSkip(to, category, "sendDirect");
        return;
      }

      const provider = getEmailProvider();
      await provider.send(this.buildParams(to, email, category, options));
    } catch {
      // Fire-and-forget
    }
  }

  /**
   * Send bulk emails. Used for broadcasts and newsletters.
   * The category is applied to every email in the batch (from / replyTo /
   * tags / headers all stamped from the registry).
   */
  async sendBulk(
    emails: Array<{ to: string; subject: string; html: string; text?: string }>,
    category: EmailCategory,
  ): Promise<BulkEmailResult> {
    if (emails.length === 0) return { total: 0, sent: 0, failed: 0, results: [] };
    try {
      // Filter out suppressed recipients before hitting Resend's batch
      // endpoint. The suppression lookups run in parallel — at the 100
      // batch cap that's 100 doc reads, fast at the volumes we project.
      // Preserves `total` = original count so the caller can see how
      // many were skipped via `sent + failed < total`.
      const suppressionFlags = await Promise.all(emails.map((e) => this.isSuppressed(e.to)));
      const deliverable = emails.filter((_, i) => !suppressionFlags[i]);
      const skipped = emails.length - deliverable.length;

      if (skipped > 0) {
        logSuppressedSkip(
          emails
            .filter((_, i) => suppressionFlags[i])
            .map((e) => e.to)
            .join(","),
          category,
          "sendBulk",
        );
      }

      if (deliverable.length === 0) {
        return {
          total: emails.length,
          sent: 0,
          failed: 0,
          results: emails.map(() => ({ success: false, error: "suppressed" })),
        };
      }

      const sender = resolveSender(category);
      const provider = getEmailProvider();
      const stamped: EmailParams[] = deliverable.map((e) => ({
        to: e.to,
        subject: e.subject,
        html: e.html,
        ...(e.text ? { text: e.text } : {}),
        from: sender.from,
        replyTo: sender.replyTo,
        tags: sender.tags,
        ...(sender.headers ? { headers: sender.headers } : {}),
      }));
      const result = await provider.sendBulk(stamped);
      // Rebase `total` to the original count so callers always see how
      // many emails entered the function; `sent + failed + suppressed`
      // accounts for all of them.
      return { ...result, total: emails.length };
    } catch {
      return { total: emails.length, sent: 0, failed: emails.length, results: [] };
    }
  }

  private buildParams(
    to: string,
    email: RenderedEmail,
    category: EmailCategory,
    options?: SendOptions,
  ): EmailParams & { idempotencyKey?: string } {
    const sender = resolveSender(category);
    const tags = options?.tags?.length ? [...sender.tags, ...options.tags] : sender.tags;

    const params: EmailParams & { idempotencyKey?: string } = {
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      from: sender.from,
      replyTo: sender.replyTo,
      tags,
    };

    if (sender.headers && Object.keys(sender.headers).length > 0) {
      params.headers = sender.headers;
    }

    if (options?.idempotencyKey) {
      params.idempotencyKey = options.idempotencyKey;
    }

    return params;
  }

  // ─── Template Helpers ──────────────────────────────────────────────────────
  // Convenience methods that combine template rendering with sending.
  // Each helper hands sendToUser a factory, so the user's preferredLanguage
  // drives the render — no double-fetch of the user doc.

  async sendRegistrationConfirmation(
    userId: string,
    params: RegistrationConfirmationParams,
  ): Promise<void> {
    await this.sendToUser(
      userId,
      (locale) => buildRegistrationEmail({ ...params, locale }),
      "transactional",
      {
        tags: [{ name: "type", value: "registration_confirmation" }],
        idempotencyKey: `reg-confirm/${params.registrationId}`,
      },
    );
  }

  async sendRegistrationApproved(
    userId: string,
    params: RegistrationApprovedParams,
  ): Promise<void> {
    await this.sendToUser(
      userId,
      (locale) => buildRegistrationApprovedEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "registration_approved" }] },
    );
  }

  async sendBadgeReady(userId: string, params: BadgeReadyParams): Promise<void> {
    await this.sendToUser(
      userId,
      (locale) => buildBadgeReadyEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "badge_ready" }] },
    );
  }

  async sendEventCancelled(userId: string, params: EventCancelledParams): Promise<void> {
    await this.sendToUser(
      userId,
      (locale) => buildEventCancelledEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "event_cancelled" }] },
    );
  }

  async sendEventReminder(userId: string, params: EventReminderParams): Promise<void> {
    await this.sendToUser(
      userId,
      (locale) => buildEventReminderEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "event_reminder" }] },
    );
  }

  async sendPaymentReceipt(userId: string, params: PaymentReceiptParams): Promise<void> {
    await this.sendToUser(
      userId,
      (locale) => buildPaymentReceiptEmail({ ...params, locale }),
      "billing",
      {
        tags: [{ name: "type", value: "payment_receipt" }],
        idempotencyKey: `payment-receipt/${params.receiptId}`,
      },
    );
  }

  async sendWelcomeNewsletter(email: string, locale?: Locale): Promise<void> {
    const template = await buildWelcomeEmail({ email, locale });
    await this.sendDirect(email, template, "marketing", {
      tags: [{ name: "type", value: "newsletter_welcome" }],
    });
  }

  /**
   * Send the double-opt-in confirmation email. Category is `transactional`
   * (not `marketing`) because the recipient hasn't confirmed consent yet —
   * this is a one-off triggered by their subscribe submission, not a
   * marketing broadcast, and Resend's List-Unsubscribe machinery doesn't
   * apply.
   */
  async sendNewsletterConfirmation(
    email: string,
    confirmationUrl: string,
    locale?: Locale,
  ): Promise<void> {
    const template = await buildNewsletterConfirmationEmail({ confirmationUrl, locale });
    await this.sendDirect(email, template, "transactional", {
      tags: [{ name: "type", value: "newsletter_confirmation" }],
    });
  }
}

export const emailService = new EmailService();

// Operator-only structured log for suppression skips. Kept out of the
// class so it doesn't pull the request logger in (this is fire-and-
// forget observability — goes to stderr, scraped by Cloud Logging).
// Per CLAUDE.md this is the sanctioned pattern for service-level
// logging: no console.log, use process.stderr.write.
function logSuppressedSkip(
  email: string,
  category: EmailCategory,
  method: "sendToUser" | "sendDirect" | "sendBulk",
  userId?: string,
): void {
  try {
    process.stderr.write(
      JSON.stringify({
        level: "info",
        event: "email.suppressed_skip",
        method,
        category,
        email,
        ...(userId ? { userId } : {}),
      }) + "\n",
    );
  } catch {
    // Logging must never throw in a fire-and-forget path.
  }
}
