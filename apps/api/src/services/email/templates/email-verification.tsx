import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, ctaButton, heading, paragraph } from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

// Branded replacement for Firebase Auth's default verification email.
//
// Flow:
//   1. User signs up on participant / backoffice web → Firebase Auth
//      creates the user.
//   2. Client POSTs to /v1/auth/send-verification-email with the user's
//      ID token; the API calls admin.auth().generateEmailVerificationLink
//      and ships THIS template to them through Resend.
//   3. User clicks CTA → lands on <participant>/auth/action?mode=
//      verifyEmail&oobCode=... → applyActionCode() marks them verified.
//
// Why not Firebase's default:
//   - Firebase sends from noreply@firebase.com which fails our DMARC
//     alignment and bypasses the Resend dashboard (no open/click/bounce
//     signal).
//   - The default template has zero Teranga branding and its i18n is
//     project-wide, not per-user.
//   - The default action URL lands on a Firebase-hosted page; we want a
//     consistent brand experience from email to landing.

export interface EmailVerificationParams {
  /**
   * Recipient's display name. Firebase stores `displayName` on the user
   * object — the route pulls it and passes through. Falls back to the
   * local-part of the email when not set, so the greeting never reads
   * "Welcome undefined".
   */
  name: string;
  /**
   * Fully-qualified action URL. Must point at <participant>/auth/action
   * (or <backoffice>/auth/action for organizer signups) — already
   * computed by the API via actionCodeSettings + publicUrls.
   */
  verificationUrl: string;
}

export function EmailVerificationEmail(params: EmailVerificationParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.emailVerification;

  return (
    <EmailLayout preview={t.preview} dict={dict}>
      <Heading style={heading}>{t.heading(params.name)}</Heading>
      <Text style={paragraph}>{t.body}</Text>

      <Button href={params.verificationUrl} style={ctaButton}>
        {t.ctaButton}
      </Button>

      <Text style={{ ...paragraph, marginTop: "16px", color: "#6B7280", fontSize: "13px" }}>
        {t.expiryNote}
      </Text>
      <Text style={{ ...paragraph, color: "#6B7280", fontSize: "13px" }}>
        {t.didNotRequestNote}
      </Text>
      <Text
        style={{
          ...paragraph,
          color: "#9CA3AF",
          fontSize: "12px",
          wordBreak: "break-all",
          marginTop: "16px",
        }}
      >
        {t.fallbackLine(params.verificationUrl)}
      </Text>

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildEmailVerificationEmail(
  params: EmailVerificationParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(dict.emailVerification.subject, <EmailVerificationEmail {...params} />);
}
