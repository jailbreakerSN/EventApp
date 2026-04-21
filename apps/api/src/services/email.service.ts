import { type EmailCategory } from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import {
  getEmailProvider,
  buildRegistrationEmail,
  buildRegistrationApprovedEmail,
  buildBadgeReadyEmail,
  buildEventCancelledEmail,
  buildEventReminderEmail,
  buildWelcomeEmail,
} from "@/providers/index";
import { type EmailParams, type BulkEmailResult } from "@/providers/email-provider.interface";
import { userRepository } from "@/repositories/user.repository";
import { resolveSender } from "./email/sender.registry";

// ─── Types ──────────────────────────────────────────────────────────────────

interface NotificationPrefs {
  email: boolean;
  sms: boolean;
  push: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = { email: true, sms: true, push: true };

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

// ─── Email Service ──────────────────────────────────────────────────────────
// Centralized service for all email sending. Handles:
// - User notification preference checking
// - Template rendering
// - Provider delegation (Resend / SendGrid / Mock)
// - Category → From/Reply-To routing via the sender registry
// All methods are fire-and-forget safe — errors are logged, never thrown.
//
// Every public send method requires an EmailCategory. This is type-enforced
// so callers cannot accidentally fall back to the legacy single sender.

export class EmailService {
  /**
   * Get a user's notification preferences. Returns defaults if no doc exists.
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
      };
    } catch {
      return DEFAULT_PREFS;
    }
  }

  /**
   * Send an email to a user, routed by category.
   *
   * Preference check: skipped for MANDATORY_CATEGORIES (auth, billing) —
   * users cannot opt out of security and financial records. For every other
   * category, `prefs.email === false` short-circuits the send.
   *
   * Always returns silently if the user has no email address.
   */
  async sendToUser(
    userId: string,
    email: { subject: string; html: string; text: string },
    category: EmailCategory,
    options?: SendOptions,
  ): Promise<void> {
    try {
      const isMandatory = MANDATORY_CATEGORIES.has(category);

      const [prefs, user] = await Promise.all([
        isMandatory ? Promise.resolve(null) : this.getPreferences(userId),
        userRepository.findById(userId),
      ]);

      if (!isMandatory && prefs && !prefs.email) return;
      if (!user?.email) return;

      const provider = getEmailProvider();
      await provider.send(this.buildParams(user.email, email, category, options));
    } catch {
      // Fire-and-forget: email failure must not block
    }
  }

  /**
   * Send an email directly to an address (no user lookup or preference check).
   * Used for newsletter subscribers, invites, and other non-user recipients.
   */
  async sendDirect(
    to: string,
    email: { subject: string; html: string; text: string },
    category: EmailCategory,
    options?: SendOptions,
  ): Promise<void> {
    try {
      const provider = getEmailProvider();
      await provider.send(this.buildParams(to, email, category, options));
    } catch {
      // Fire-and-forget
    }
  }

  /**
   * Send bulk emails. Used for broadcasts and newsletters.
   * The category is applied to every email in the batch.
   */
  async sendBulk(
    emails: Array<{ to: string; subject: string; html: string; text?: string }>,
    category: EmailCategory,
  ): Promise<BulkEmailResult> {
    if (emails.length === 0) return { total: 0, sent: 0, failed: 0, results: [] };
    try {
      const sender = resolveSender(category);
      const provider = getEmailProvider();
      const stamped: EmailParams[] = emails.map((e) => ({
        to: e.to,
        subject: e.subject,
        html: e.html,
        ...(e.text ? { text: e.text } : {}),
        from: sender.from,
        replyTo: sender.replyTo,
        tags: sender.tags,
      }));
      return await provider.sendBulk(stamped);
    } catch {
      return { total: emails.length, sent: 0, failed: emails.length, results: [] };
    }
  }

  private buildParams(
    to: string,
    email: { subject: string; html: string; text: string },
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

    if (options?.idempotencyKey) {
      params.idempotencyKey = options.idempotencyKey;
    }

    return params;
  }

  // ─── Template Helpers ──────────────────────────────────────────────────────
  // Convenience methods that combine template rendering with sending.

  async sendRegistrationConfirmation(
    userId: string,
    params: {
      participantName: string;
      eventTitle: string;
      eventDate: string;
      eventLocation: string;
      ticketName: string;
      registrationId: string;
      badgeUrl?: string;
    },
  ): Promise<void> {
    const email = buildRegistrationEmail(params);
    await this.sendToUser(userId, email, "transactional", {
      tags: [{ name: "type", value: "registration_confirmation" }],
      idempotencyKey: `reg-confirm:${params.registrationId}`,
    });
  }

  async sendRegistrationApproved(
    userId: string,
    params: {
      participantName: string;
      eventTitle: string;
      eventDate: string;
      eventLocation: string;
      badgeUrl?: string;
    },
  ): Promise<void> {
    const email = buildRegistrationApprovedEmail(params);
    await this.sendToUser(userId, email, "transactional", {
      tags: [{ name: "type", value: "registration_approved" }],
    });
  }

  async sendBadgeReady(
    userId: string,
    params: {
      participantName: string;
      eventTitle: string;
      badgeUrl?: string;
    },
  ): Promise<void> {
    const email = buildBadgeReadyEmail(params);
    await this.sendToUser(userId, email, "transactional", {
      tags: [{ name: "type", value: "badge_ready" }],
    });
  }

  async sendEventCancelled(
    userId: string,
    params: {
      participantName: string;
      eventTitle: string;
      eventDate: string;
    },
  ): Promise<void> {
    const email = buildEventCancelledEmail(params);
    await this.sendToUser(userId, email, "transactional", {
      tags: [{ name: "type", value: "event_cancelled" }],
    });
  }

  async sendEventReminder(
    userId: string,
    params: {
      participantName: string;
      eventTitle: string;
      eventDate: string;
      eventLocation: string;
      timeUntil: string;
    },
  ): Promise<void> {
    const email = buildEventReminderEmail(params);
    await this.sendToUser(userId, email, "transactional", {
      tags: [{ name: "type", value: "event_reminder" }],
    });
  }

  async sendWelcomeNewsletter(email: string): Promise<void> {
    const template = buildWelcomeEmail({ email });
    await this.sendDirect(email, template, "marketing", {
      tags: [{ name: "type", value: "newsletter_welcome" }],
    });
  }
}

export const emailService = new EmailService();
