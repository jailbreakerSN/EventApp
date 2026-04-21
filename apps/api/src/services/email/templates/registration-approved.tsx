import { Button, Heading, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  ctaButton,
  heading,
  infoLabel,
  infoRow,
  infoTable,
  infoValue,
  noticeBoxMuted,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

export interface RegistrationApprovedParams {
  participantName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  badgeUrl?: string;
}

export function RegistrationApprovedEmail(
  params: RegistrationApprovedParams & { locale?: Locale },
) {
  const dict = pickDict(params.locale);
  const t = dict.registrationApproved;

  return (
    <EmailLayout preview={t.preview} dict={dict}>
      <Heading style={heading}>{t.heading}</Heading>
      <Text style={paragraph}>{dict.common.greeting(params.participantName)}</Text>
      <Text style={paragraph}>{t.body(params.eventTitle)}</Text>

      <Section style={infoTable}>
        <div style={infoRow}>
          <div style={infoLabel}>{t.dateLabel}</div>
          <div style={infoValue}>{params.eventDate}</div>
        </div>
        <div style={infoRow}>
          <div style={infoLabel}>{t.locationLabel}</div>
          <div style={infoValue}>{params.eventLocation}</div>
        </div>
      </Section>

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

export function buildRegistrationApprovedEmail(
  params: RegistrationApprovedParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(
    dict.registrationApproved.subject(params.eventTitle),
    <RegistrationApprovedEmail {...params} />,
  );
}
