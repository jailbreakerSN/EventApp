import crypto from "node:crypto";
import { type EmailCategory, isKnownNotificationKey } from "@teranga/shared-types";
import { notificationDispatcher, isDispatcherEnabled } from "./notification-dispatcher.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { unsubscribeUrl } from "@/config/public-urls";
import { getEmailProvider } from "@/providers/index";
import { type EmailParams, type BulkEmailResult } from "@/providers/email-provider.interface";
import { userRepository } from "@/repositories/user.repository";
import { resolveSender } from "./email/sender.registry";
import { asLocale, type Locale } from "./email/i18n";
import { type RenderedEmail } from "./email/render";
import {
  signUnsubscribeToken,
  type UnsubscribableCategory,
} from "./notifications/unsubscribe-token";
import {
  buildRegistrationEmail,
  buildRegistrationApprovedEmail,
  buildBadgeReadyEmail,
  buildEventCancelledEmail,
  buildEventReminderEmail,
  buildWelcomeEmail,
  buildPaymentReceiptEmail,
  buildNewsletterConfirmationEmail,
  buildEmailVerificationEmail,
  buildPasswordResetEmail,
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

const UNSUBSCRIBABLE_CATEGORIES: ReadonlySet<EmailCategory> = new Set([
  "transactional",
  "organizational",
  "marketing",
]);

function isUnsubscribableCategory(category: EmailCategory): category is UnsubscribableCategory {
  return UNSUBSCRIBABLE_CATEGORIES.has(category);
}

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
        logSuppressedSkip(redactEmail(user.email), category, "sendToUser", userId);
        return;
      }

      const locale = asLocale(user.preferredLanguage) ?? DEFAULT_LOCALE;
      const email = await template(locale);

      const provider = getEmailProvider();
      await provider.send(this.buildParams(user.email, email, category, options, userId));
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
        logSuppressedSkip(redactEmail(to), category, "sendDirect");
        return;
      }

      const provider = getEmailProvider();
      await provider.send(this.buildParams(to, email, category, options));
    } catch {
      // Fire-and-forget
    }
  }

  /**
   * Send bulk emails. Used for organizer broadcasts and newsletter fan-outs.
   * The category is applied to every email in the batch (from / replyTo /
   * tags / headers all stamped from the registry).
   *
   * ⚠ Contract: the **caller** is responsible for filtering recipients by
   * per-user email preferences before calling. `sendBulk` knows nothing
   * about users — it receives bare `{ to, subject, html }` records. It
   * consults ONLY the platform-wide suppression list (hard bounces +
   * complaints) and the RFC 8058 headers added by the sender registry.
   * If you pass a recipient who has toggled off their per-category
   * preference in Settings, they WILL still receive the email.
   *
   * See `broadcast.service.ts#sendBroadcast` for the canonical pattern:
   * fetch `getPreferences(userId)` per recipient, gate on
   * `isEmailCategoryEnabled(prefs, category)`, then pass only the
   * survivors here. `sendToUser` does all of that internally because it
   * has the `userId` to work with.
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
        // Redact each address before stringifying — raw emails in a
        // comma-joined stderr log would land in Cloud Logging (30-day
        // retention, readable by any principal with
        // `logging.logEntries.list`). `redactEmail` hashes the local
        // part while keeping the domain for drift analytics. Mirrors
        // the pattern used by reconcileResendSegment on the Functions
        // side.
        logSuppressedSkip(
          emails
            .filter((_, i) => suppressionFlags[i])
            .map((e) => redactEmail(e.to))
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
    userId?: string,
  ): EmailParams & { idempotencyKey?: string } {
    const sender = resolveSender(category);
    const tags = options?.tags?.length ? [...sender.tags, ...options.tags] : sender.tags;

    // Start with the sender registry's static headers (e.g. News&Marketing
    // List-Unsubscribe), then layer on a per-recipient signed token for
    // non-mandatory categories when we know the userId. Gmail / Apple
    // Mail render this as a native "Unsubscribe" button; RFC 8058 one-
    // click POST fires the paired POST endpoint with the same token.
    const headers: Record<string, string> = { ...(sender.headers ?? {}) };
    if (userId && isUnsubscribableCategory(category)) {
      const token = signUnsubscribeToken(userId, category);
      const url = unsubscribeUrl(token);
      // Merge with any mailto: from the sender registry. Gmail prefers
      // https when both are present (one-click compatible).
      headers["List-Unsubscribe"] = [
        `<${url}>`,
        headers["List-Unsubscribe"] ? headers["List-Unsubscribe"].replace(/^,?\s*/, "") : null,
      ]
        .filter(Boolean)
        .join(", ");
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    const params: EmailParams & { idempotencyKey?: string } = {
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      from: sender.from,
      replyTo: sender.replyTo,
      tags,
    };

    if (Object.keys(headers).length > 0) {
      params.headers = headers;
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
  //
  // Phase 1 rollout: when NOTIFICATIONS_DISPATCHER_ENABLED is true, these
  // methods route through the NotificationDispatcherService (catalog
  // lookup, admin kill-switch, per-key user opt-out, audit trail). Flag
  // defaults to false in prod so the legacy code path stays authoritative
  // until Phase 2 migrates listeners to call dispatch() directly.

  /**
   * Dispatch through the catalog when the feature flag is on. Returns
   * `true` when dispatched (caller should short-circuit); `false` when
   * the legacy path should run.
   *
   * Unknown catalog keys fall through to `false` so a typo in a shim's
   * key literal doesn't silently swallow the send — the dispatcher would
   * log-and-return for unknown keys, but returning `true` here would
   * skip the legacy send AND drop the email. See security review P1-1
   * (docs/notification-system-architecture.md §16).
   */
  private async tryDispatch(
    key: string,
    userId: string | undefined,
    email: string | undefined,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<boolean> {
    if (!isDispatcherEnabled()) return false;
    if (!isKnownNotificationKey(key)) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "email.try_dispatch.unknown_key",
          key,
        }) + "\n",
      );
      return false;
    }
    await notificationDispatcher.dispatch({
      key,
      recipients: [
        {
          ...(userId ? { userId } : {}),
          ...(email ? { email } : {}),
          preferredLocale: "fr",
        },
      ],
      params,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return true;
  }

  async sendRegistrationConfirmation(
    userId: string,
    params: RegistrationConfirmationParams,
  ): Promise<void> {
    if (
      await this.tryDispatch(
        "registration.created",
        userId,
        undefined,
        params as unknown as Record<string, unknown>,
        `reg-confirm/${params.registrationId}`,
      )
    ) {
      return;
    }
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
    if (
      await this.tryDispatch(
        "registration.approved",
        userId,
        undefined,
        params as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }
    await this.sendToUser(
      userId,
      (locale) => buildRegistrationApprovedEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "registration_approved" }] },
    );
  }

  async sendBadgeReady(userId: string, params: BadgeReadyParams): Promise<void> {
    if (
      await this.tryDispatch(
        "badge.ready",
        userId,
        undefined,
        params as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }
    await this.sendToUser(
      userId,
      (locale) => buildBadgeReadyEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "badge_ready" }] },
    );
  }

  async sendEventCancelled(userId: string, params: EventCancelledParams): Promise<void> {
    if (
      await this.tryDispatch(
        "event.cancelled",
        userId,
        undefined,
        params as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }
    await this.sendToUser(
      userId,
      (locale) => buildEventCancelledEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "event_cancelled" }] },
    );
  }

  async sendEventReminder(userId: string, params: EventReminderParams): Promise<void> {
    if (
      await this.tryDispatch(
        "event.reminder",
        userId,
        undefined,
        params as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }
    await this.sendToUser(
      userId,
      (locale) => buildEventReminderEmail({ ...params, locale }),
      "transactional",
      { tags: [{ name: "type", value: "event_reminder" }] },
    );
  }

  async sendPaymentReceipt(userId: string, params: PaymentReceiptParams): Promise<void> {
    if (
      await this.tryDispatch(
        "payment.succeeded",
        userId,
        undefined,
        params as unknown as Record<string, unknown>,
        `payment-receipt/${params.receiptId}`,
      )
    ) {
      return;
    }
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
    if (await this.tryDispatch("newsletter.welcome", undefined, email, { email, locale })) {
      return;
    }
    const template = await buildWelcomeEmail({ email, locale });
    await this.sendDirect(email, template, "marketing", {
      tags: [{ name: "type", value: "newsletter_welcome" }],
    });
  }

  /**
   * Send the branded email-verification email. The caller (auth-email
   * service) has already minted the Firebase OOB link via
   * admin.auth().generateEmailVerificationLink; this just wraps our
   * template + provider. Category is `auth` so the sender registry
   * routes through events@ with Reply-To: support@.
   */
  async sendEmailVerification(
    email: string,
    params: { name: string; verificationUrl: string; locale?: Locale },
  ): Promise<void> {
    if (
      await this.tryDispatch(
        "auth.email_verification",
        undefined,
        email,
        params as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }
    const template = await buildEmailVerificationEmail(params);
    await this.sendDirect(email, template, "auth", {
      tags: [{ name: "type", value: "email_verification" }],
    });
  }

  /**
   * Send the branded password-reset email. Same rationale as
   * sendEmailVerification — we ship the Firebase OOB link through our
   * template and provider instead of letting Firebase's default mailer
   * handle it, so From header, DMARC alignment, and tracking stay on
   * the Teranga brand.
   */
  async sendPasswordReset(
    email: string,
    params: { resetUrl: string; locale?: Locale },
  ): Promise<void> {
    if (
      await this.tryDispatch(
        "auth.password_reset",
        undefined,
        email,
        params as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }
    const template = await buildPasswordResetEmail(params);
    await this.sendDirect(email, template, "auth", {
      tags: [{ name: "type", value: "password_reset" }],
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
    if (
      await this.tryDispatch("newsletter.confirm", undefined, email, { confirmationUrl, locale })
    ) {
      return;
    }
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
//
// `emailRedacted` carries `<8-char-hash>@<domain>` values only — callers
// must pre-redact with `redactEmail()`. Raw addresses would leak PII into
// Cloud Logging (30-day retention, readable by `logging.logEntries.list`).
function logSuppressedSkip(
  emailRedacted: string,
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
        emailRedacted,
        ...(userId ? { userId } : {}),
      }) + "\n",
    );
  } catch {
    // Logging must never throw in a fire-and-forget path.
  }
}

/**
 * Hash the local part of an email while keeping the domain for drift
 * analytics. Returns `<8-char-sha256-prefix>@<domain>`. Not reversible
 * to the original address. Mirrors `redactEmail` in
 * apps/functions/src/triggers/resend/reconcile-resend-segment.scheduled.ts
 * so log consumers can join on the hash across API + Functions logs.
 */
function redactEmail(email: string): string {
  const lower = email.toLowerCase();
  const [, domain = "?"] = lower.split("@");
  const hash = crypto.createHash("sha256").update(lower).digest("hex").slice(0, 8);
  return `${hash}@${domain}`;
}
