import { Heading, Text } from "@react-email/components";
import {
  EmailLayout,
  headingCancelled,
  noticeBoxError,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

export interface EventCancelledParams {
  participantName: string;
  eventTitle: string;
  eventDate: string;
}

export function EventCancelledEmail(params: EventCancelledParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.eventCancelled;

  return (
    <EmailLayout preview={t.preview} dict={dict}>
      <Heading style={headingCancelled}>{t.heading}</Heading>
      <Text style={paragraph}>{dict.common.greeting(params.participantName)}</Text>
      <Text style={paragraph}>{t.body(params.eventTitle, params.eventDate)}</Text>
      <Text style={noticeBoxError}>{t.contactOrganizer}</Text>
      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildEventCancelledEmail(
  params: EventCancelledParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(
    dict.eventCancelled.subject(params.eventTitle),
    <EventCancelledEmail {...params} />,
  );
}
