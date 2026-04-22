import { Button, Heading, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  ctaButton,
  heading,
  headingCancelled,
  infoLabel,
  infoRow,
  infoTable,
  infoValue,
  noticeBoxError,
  noticeBoxMuted,
  noticeBoxSuccess,
  noticeBoxWarning,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

// ─── Generic Template Shell ────────────────────────────────────────────────
// Reusable react-email scaffolding for the Phase 2 notifications. Each
// concrete template (PaymentFailed, InviteSent, WaitlistPromoted, etc.) is
// now a thin wrapper that supplies its own localized strings via the
// `i18nMessages` helper below, instead of extending the central Dictionary
// with one new section per notification.
//
// Why not extend the Dictionary? Phase 2 adds 14+ templates. That's 14+
// new required keys times 3 locale files = 42 strict-typing boilerplate
// edits just to ship the scaffolding. The central Dictionary stays
// focused on the Phase 1 baseline (the 10 shipped helpers); Phase 2
// templates keep their copy next to the template itself so reviewers see
// the full notification in one file.
//
// Design language — same tokens as the Dictionary templates:
//   • EmailLayout header + footer (brand navy / gold, Teranga footer)
//   • Heading → paragraph body → optional info table → optional CTA
//   • Tone-specific notice box (success / warning / error / muted)
//   • Signoff at the bottom, always "L'équipe Teranga" (from dict.common)

export type NotificationTone = "neutral" | "success" | "warning" | "error" | "cancelled";

export interface NotificationInfoRow {
  label: string;
  value: string;
}

export interface NotificationCta {
  label: string;
  url: string;
}

export interface NotificationTemplateProps {
  locale?: Locale;
  /** Optional first-line greeting, e.g. "Bonjour Awa,". When omitted, uses dict.common.greeting(recipientName) if recipientName is set. */
  recipientName?: string;
  /** Email subject — distinct from the heading to allow short subjects. */
  subject: string;
  /** Inbox preview text (≤ 90 chars). */
  preview: string;
  /** Large heading at the top of the card. */
  heading: string;
  /** Tone controls the heading accent + notice-box colour. */
  tone?: NotificationTone;
  /** One or more body paragraphs rendered before the optional info table. */
  bodyParagraphs: string[];
  /** Optional label/value rows shown as a table (e.g., amount, receipt id). */
  infoRows?: NotificationInfoRow[];
  /** Optional tone-boxed notice line shown just before the CTA. */
  notice?: string;
  /** Primary call-to-action button (only one — keeps mobile layout clean). */
  primaryCta?: NotificationCta;
  /** Optional secondary line shown below the CTA (e.g. "If the button doesn't work..."). */
  secondaryHint?: string;
  /** Optional RFC 8058 unsubscribe note in the footer (marketing only). */
  unsubscribeNote?: string;
}

export function NotificationTemplate(props: NotificationTemplateProps) {
  const dict = pickDict(props.locale);
  const tone = props.tone ?? "neutral";

  const headingStyle = tone === "cancelled" ? headingCancelled : heading;
  const noticeStyle =
    tone === "success"
      ? noticeBoxSuccess
      : tone === "warning"
        ? noticeBoxWarning
        : tone === "error" || tone === "cancelled"
          ? noticeBoxError
          : noticeBoxMuted;

  return (
    <EmailLayout preview={props.preview} dict={dict} unsubscribeNote={props.unsubscribeNote}>
      <Heading style={headingStyle}>{props.heading}</Heading>

      {props.recipientName ? (
        <Text style={paragraph}>{dict.common.greeting(props.recipientName)}</Text>
      ) : null}

      {props.bodyParagraphs.map((p, i) => (
        <Text key={`p-${i}`} style={paragraph}>
          {p}
        </Text>
      ))}

      {props.infoRows && props.infoRows.length > 0 ? (
        <Section style={infoTable}>
          {props.infoRows.map((row, i) => (
            <div key={`row-${i}`} style={infoRow}>
              <div style={infoLabel}>{row.label}</div>
              <div style={infoValue}>{row.value}</div>
            </div>
          ))}
        </Section>
      ) : null}

      {props.notice ? <Text style={noticeStyle}>{props.notice}</Text> : null}

      {props.primaryCta ? (
        <Button href={props.primaryCta.url} style={ctaButton}>
          {props.primaryCta.label}
        </Button>
      ) : null}

      {props.secondaryHint ? (
        <Text style={{ ...paragraph, marginTop: "16px", fontSize: "13px", opacity: 0.75 }}>
          {props.secondaryHint}
        </Text>
      ) : null}

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildNotificationTemplate(
  props: NotificationTemplateProps,
): Promise<RenderedEmail> {
  return renderEmail(props.subject, <NotificationTemplate {...props} />);
}

// ─── Inline i18n helper ────────────────────────────────────────────────────
// Per-template locale map picker. Each template declares its own
// `MESSAGES: Record<Locale, {...}>` const at the top; this helper resolves
// the active locale with fr as the default fallback, matching the central
// pickDict behaviour.

export function pickMessages<T>(locale: Locale | undefined, messages: Record<Locale, T>): T {
  if (locale === "en") return messages.en;
  if (locale === "wo") return messages.wo;
  return messages.fr;
}
