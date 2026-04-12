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

// ─── Types ──────────────────────────────────────────────────────────────────

interface NotificationPrefs {
  email: boolean;
  sms: boolean;
  push: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = { email: true, sms: true, push: true };

// ─── Email Service ──────────────────────────────────────────────────────────
// Centralized service for all email sending. Handles:
// - User notification preference checking
// - Template rendering
// - Provider delegation (Resend / SendGrid / Mock)
// All methods are fire-and-forget safe — errors are logged, never thrown.

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
   * Send a transactional email to a user, respecting their notification preferences.
   * Returns silently if the user has email disabled or has no email address.
   */
  async sendToUser(
    userId: string,
    email: { subject: string; html: string; text: string },
    options?: { tags?: { name: string; value: string }[]; idempotencyKey?: string },
  ): Promise<void> {
    try {
      const [prefs, user] = await Promise.all([
        this.getPreferences(userId),
        userRepository.findById(userId),
      ]);

      if (!prefs.email) return;
      if (!user?.email) return;

      const provider = getEmailProvider();
      await provider.send({
        to: user.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...options,
      } as EmailParams);
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
  ): Promise<void> {
    try {
      const provider = getEmailProvider();
      await provider.send({ to, subject: email.subject, html: email.html, text: email.text });
    } catch {
      // Fire-and-forget
    }
  }

  /**
   * Send bulk emails. Used for broadcasts and newsletters.
   * Delegates directly to the provider's batch endpoint.
   */
  async sendBulk(emails: EmailParams[]): Promise<BulkEmailResult> {
    if (emails.length === 0) return { total: 0, sent: 0, failed: 0, results: [] };
    try {
      const provider = getEmailProvider();
      return await provider.sendBulk(emails);
    } catch {
      return { total: emails.length, sent: 0, failed: emails.length, results: [] };
    }
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
    await this.sendToUser(userId, email, {
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
    await this.sendToUser(userId, email, {
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
    await this.sendToUser(userId, email, {
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
    await this.sendToUser(userId, email, {
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
    await this.sendToUser(userId, email, {
      tags: [{ name: "type", value: "event_reminder" }],
    });
  }

  async sendWelcomeNewsletter(email: string): Promise<void> {
    const template = buildWelcomeEmail({ email });
    await this.sendDirect(email, template);
  }
}

export const emailService = new EmailService();
