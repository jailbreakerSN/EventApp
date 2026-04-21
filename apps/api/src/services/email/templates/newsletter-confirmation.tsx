import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout, ctaButton, heading, paragraph } from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

// Double-opt-in confirmation email. Sent by newsletter.service.subscribe()
// as soon as the pending row lands in Firestore. The link resolves to
// GET /v1/newsletter/confirm?token=<signed-token>, which flips the
// subscriber row to "confirmed" and fires the welcome email + Resend
// mirror (via the Firestore trigger).
//
// Transactional single-send, not a broadcast — the user hasn't confirmed
// consent yet and isn't in the Resend Segment.

export interface NewsletterConfirmationParams {
  /** Fully-qualified URL including the signed token. */
  confirmationUrl: string;
}

export function NewsletterConfirmationEmail(
  params: NewsletterConfirmationParams & { locale?: Locale },
) {
  const dict = pickDict(params.locale);
  const t = dict.newsletterConfirmation;

  return (
    <EmailLayout preview={t.preview} dict={dict}>
      <Heading style={heading}>{t.heading}</Heading>
      <Text style={paragraph}>{t.body}</Text>

      <Button href={params.confirmationUrl} style={ctaButton}>
        {t.ctaButton}
      </Button>

      <Text style={{ ...paragraph, marginTop: "16px", color: "#6B7280", fontSize: "13px" }}>
        {t.expiryNote}
      </Text>
      <Text style={{ ...paragraph, color: "#6B7280", fontSize: "13px" }}>
        {t.didNotSubscribeNote}
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
        {t.fallbackLine(params.confirmationUrl)}
      </Text>

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildNewsletterConfirmationEmail(
  params: NewsletterConfirmationParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(
    dict.newsletterConfirmation.subject,
    <NewsletterConfirmationEmail {...params} />,
  );
}
