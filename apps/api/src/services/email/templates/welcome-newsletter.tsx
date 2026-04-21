import { Heading, Text } from "@react-email/components";
import { EmailLayout, heading, noticeBoxSuccess, paragraph } from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

export interface WelcomeNewsletterParams {
  email?: string;
}

export function WelcomeNewsletterEmail(params: WelcomeNewsletterParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.welcomeNewsletter;

  return (
    // Marketing category → unsubscribe footer is mandatory (Gmail/Yahoo bulk-sender rules).
    // The RFC 8058 headers are set at the provider layer; this visible line
    // is the backup for clients that don't honor them.
    <EmailLayout preview={t.preview} dict={dict} unsubscribeNote={t.unsubscribeNote}>
      <Heading style={heading}>{t.heading}</Heading>
      <Text style={paragraph}>{t.body}</Text>
      <Text style={paragraph}>{t.closing}</Text>
      <Text style={noticeBoxSuccess}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildWelcomeEmail(
  params: WelcomeNewsletterParams & { locale?: Locale } = {},
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(dict.welcomeNewsletter.subject, <WelcomeNewsletterEmail {...params} />);
}
