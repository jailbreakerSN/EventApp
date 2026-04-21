import { Button, Heading, Text } from "@react-email/components";
import {
  EmailLayout,
  ctaButton,
  heading,
  noticeBoxError,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

// Branded replacement for Firebase Auth's default password reset email.
//
// Same architecture as email-verification.tsx — the API calls
// admin.auth().generatePasswordResetLink() to get the OOB URL without
// triggering Firebase's built-in mailer, then we ship this template via
// Resend. Landing page at <participant>/auth/action?mode=resetPassword
// &oobCode=... handles the new-password form.
//
// Security-critical copy notes:
//   - Never put the user's email in the subject. Inbox previews leak
//     otherwise, and receiving spam that reads "Password reset for
//     foo@bar" trains people to treat phishing clones as legit.
//   - The "didn't request this?" note goes into a VISIBLE warning box
//     (noticeBoxError) — not a fine-print paragraph. Password reset
//     emails are the prime target of credential-phishing clones, so
//     the counter-copy has to be impossible to miss.
//   - Reply-To is support@ (sender registry routes auth → events@
//     with Reply-To support@) so a confused user who hits reply lands
//     with a human, not a bounce.

export interface PasswordResetParams {
  /**
   * Fully-qualified action URL. Points at <participant>/auth/action
   * (or <backoffice>/auth/action for organizer accounts) — assembled
   * by the API from actionCodeSettings + publicUrls.
   */
  resetUrl: string;
}

export function PasswordResetEmail(params: PasswordResetParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.passwordReset;

  return (
    <EmailLayout preview={t.preview} dict={dict}>
      <Heading style={heading}>{t.heading}</Heading>
      <Text style={paragraph}>{t.body}</Text>

      <Button href={params.resetUrl} style={ctaButton}>
        {t.ctaButton}
      </Button>

      <Text style={{ ...paragraph, marginTop: "16px", color: "#6B7280", fontSize: "13px" }}>
        {t.expiryNote}
      </Text>

      {/* Security box — visible warning, not fine print. */}
      <Text style={{ ...noticeBoxError, marginTop: "16px" }}>{t.didNotRequestNote}</Text>

      <Text
        style={{
          ...paragraph,
          color: "#9CA3AF",
          fontSize: "12px",
          wordBreak: "break-all",
          marginTop: "16px",
        }}
      >
        {t.fallbackLine(params.resetUrl)}
      </Text>

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildPasswordResetEmail(
  params: PasswordResetParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(dict.passwordReset.subject, <PasswordResetEmail {...params} />);
}
