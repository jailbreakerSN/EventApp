import { Button, Heading, Text } from "@react-email/components";
import {
  EmailLayout,
  ctaButton,
  heading,
  noticeBoxMuted,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

export interface BadgeReadyParams {
  participantName: string;
  eventTitle: string;
  badgeUrl?: string;
}

export function BadgeReadyEmail(params: BadgeReadyParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.badgeReady;

  return (
    <EmailLayout preview={t.preview} dict={dict}>
      <Heading style={heading}>{t.heading}</Heading>
      <Text style={paragraph}>{dict.common.greeting(params.participantName)}</Text>
      <Text style={paragraph}>{t.body(params.eventTitle)}</Text>

      {params.badgeUrl ? (
        <Button href={params.badgeUrl} style={ctaButton}>
          {t.downloadBadgeCta}
        </Button>
      ) : (
        <Text style={noticeBoxMuted}>{t.badgeInAppHint}</Text>
      )}

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildBadgeReadyEmail(
  params: BadgeReadyParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(dict.badgeReady.subject(params.eventTitle), <BadgeReadyEmail {...params} />);
}
