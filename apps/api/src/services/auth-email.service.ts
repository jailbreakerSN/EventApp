import { FirebaseAuthError } from "firebase-admin/auth";
import { auth } from "@/config/firebase";
import { authActionUrl, type AuthActionAudience } from "@/config/public-urls";
import { emailService } from "@/services/email.service";
import { asLocale, type Locale } from "@/services/email/i18n";
import { NotFoundError, ValidationError } from "@/errors/app-error";

// ─── Auth email service ─────────────────────────────────────────────────
//
// Generates Firebase Auth out-of-band (OOB) action links via the Admin
// SDK and sends them through our own Resend-backed emailService, instead
// of letting Firebase's default mailer do it.
//
// Why bypass Firebase's built-in send:
//   - Firebase sends from `noreply@firebase.com`, which fails SPF + DMARC
//     alignment against terangaevent.com. We just set up DMARC; this
//     path would create DMARC-failing mail going forward and undo the
//     deliverability work.
//   - The default template is un-branded and can only be customised
//     within the narrow Console fields — no react-email, no i18n at the
//     per-user level, no variable interpolation beyond a few tokens.
//   - The default action URL lands on a Firebase-hosted page
//     (*.firebaseapp.com/__/auth/action) — again un-branded.
//   - We lose all engagement signal (open / click / bounce) because
//     Firebase's mailer doesn't emit Resend webhooks.
//
// `admin.auth().generateXLink()` is the documented escape hatch for
// exactly this use case: it produces the OOB link but doesn't send
// anything. We then pick the template and the sender.
//
// Locale: pulled from the user's `preferredLanguage` claim / Firestore
// doc when available, otherwise French. The email template's i18n
// handles unknown values gracefully, so even a totally missing locale
// still renders.

export type EmailVerificationAudience = AuthActionAudience;

export interface SendEmailVerificationParams {
  /** Already-authenticated user's uid; used to look up email + displayName. */
  userId: string;
  /**
   * Which web app hosts the landing page for this user. Participants
   * land on app.terangaevent.com; organizer / staff sign-ups land on
   * admin.terangaevent.com. The landing path is the same; only the
   * host differs.
   */
  audience: EmailVerificationAudience;
  /** User's preferred language; falls back to French if undefined/unknown. */
  locale?: string | null;
}

export interface SendPasswordResetParams {
  /** Email address to reset. Public endpoint — user may not be signed in. */
  email: string;
  audience: AuthActionAudience;
  locale?: string | null;
}

export class AuthEmailService {
  /**
   * Mint an email-verification link and ship the branded email. The
   * caller must have already authenticated the user (see routes/
   * auth-email.routes.ts) — we trust the userId. Returns silently on
   * success; swallows "user already verified" because rapidly re-
   * clicking the resend button shouldn't 400.
   */
  async sendVerificationEmail(params: SendEmailVerificationParams): Promise<void> {
    const user = await this.getUserOrThrow(params.userId);

    if (user.emailVerified) {
      // Already-verified is a happy no-op. Don't burn a Resend send
      // on an idempotent click.
      return;
    }
    if (!user.email) {
      throw new ValidationError("Utilisateur sans adresse e-mail");
    }

    const actionUrl = authActionUrl(params.audience);
    const verificationUrl = await auth.generateEmailVerificationLink(user.email, {
      url: actionUrl,
      handleCodeInApp: false,
    });

    await emailService.sendEmailVerification(user.email, {
      // Display name fallback: local-part of the email rather than "undefined".
      // A friendlier greeting. Stored display names take precedence.
      name: user.displayName?.trim() || user.email.split("@")[0],
      verificationUrl,
      locale: asLocale(params.locale) ?? defaultLocale(),
    });
  }

  /**
   * Mint a password-reset link and ship the branded email. Public
   * endpoint — we don't authenticate the user (they've forgotten their
   * password). To prevent enumeration attacks we ALWAYS return success
   * from the caller; this method silently no-ops when the email isn't
   * a registered user.
   */
  async sendPasswordResetEmail(params: SendPasswordResetParams): Promise<void> {
    const normalized = params.email.trim().toLowerCase();

    // Existence probe via Admin SDK. The route still returns 200 + the
    // same generic message whether the user exists or not (set by the
    // route layer), so this branch stays server-internal and never
    // leaks enumeration signal to the caller.
    let exists = true;
    try {
      await auth.getUserByEmail(normalized);
    } catch (err) {
      if (isAuthNotFound(err)) {
        exists = false;
      } else {
        throw err;
      }
    }
    if (!exists) return;

    const actionUrl = authActionUrl(params.audience);
    const resetUrl = await auth.generatePasswordResetLink(normalized, {
      url: actionUrl,
      handleCodeInApp: false,
    });

    await emailService.sendPasswordReset(normalized, {
      resetUrl,
      locale: asLocale(params.locale) ?? defaultLocale(),
    });
  }

  private async getUserOrThrow(userId: string) {
    try {
      return await auth.getUser(userId);
    } catch (err) {
      if (isAuthNotFound(err)) throw new NotFoundError("Utilisateur");
      throw err;
    }
  }
}

function isAuthNotFound(err: unknown): boolean {
  return err instanceof FirebaseAuthError && err.code === "auth/user-not-found";
}

function defaultLocale(): Locale {
  return "fr";
}

export const authEmailService = new AuthEmailService();
