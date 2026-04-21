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

export interface RegistrationConfirmationParams {
  participantName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  ticketName: string;
  registrationId: string;
  badgeUrl?: string;
}

export function RegistrationConfirmationEmail(
  params: RegistrationConfirmationParams & { locale?: Locale },
) {
  const dict = pickDict(params.locale);
  const t = dict.registrationConfirmation;

  return (
    <EmailLayout preview={t.preview(params.eventTitle)} dict={dict}>
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
        <div style={infoRow}>
          <div style={infoLabel}>{t.ticketLabel}</div>
          <div style={infoValue}>{params.ticketName}</div>
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

export function buildRegistrationEmail(
  params: RegistrationConfirmationParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(
    dict.registrationConfirmation.subject(params.eventTitle),
    <RegistrationConfirmationEmail {...params} />,
  );
}
