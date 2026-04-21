import { Heading, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  heading,
  infoLabel,
  infoRow,
  infoTable,
  infoValue,
  noticeBoxWarning,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

export interface EventReminderParams {
  participantName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  timeUntil: string;
}

export function EventReminderEmail(params: EventReminderParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.eventReminder;

  return (
    <EmailLayout preview={t.preview(params.eventTitle)} dict={dict}>
      <Heading style={heading}>{t.heading(params.timeUntil)}</Heading>
      <Text style={paragraph}>{dict.common.greeting(params.participantName)}</Text>
      <Text style={paragraph}>{t.body(params.eventTitle, params.timeUntil)}</Text>

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

      <Text style={noticeBoxWarning}>{t.dontForgetBadge}</Text>

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildEventReminderEmail(
  params: EventReminderParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(
    dict.eventReminder.subject(params.eventTitle, params.timeUntil),
    <EventReminderEmail {...params} />,
  );
}
