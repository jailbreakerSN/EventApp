import { Heading, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  heading,
  infoLabel,
  infoRow,
  infoTable,
  infoValue,
  noticeBoxSuccess,
  paragraph,
} from "../components/EmailLayout";
import { pickDict, type Locale } from "../i18n";
import { renderEmail, type RenderedEmail } from "../render";

// Dedicated payment-receipt template. Replaces the previous misuse of
// buildRegistrationEmail for payment.succeeded emails — receipts are a
// legal/financial record and need their own subject line, body, and info
// rows (amount, reference, date) so customers can file them for expenses.

export interface PaymentReceiptParams {
  participantName: string;
  amount: string; // Pre-formatted currency string (e.g., "25 000 FCFA").
  eventTitle: string;
  receiptId: string;
  paymentDate: string; // Pre-formatted date string.
}

export function PaymentReceiptEmail(params: PaymentReceiptParams & { locale?: Locale }) {
  const dict = pickDict(params.locale);
  const t = dict.paymentReceipt;

  return (
    <EmailLayout preview={t.preview(params.amount)} dict={dict}>
      <Heading style={heading}>{t.heading}</Heading>
      <Text style={paragraph}>{dict.common.greeting(params.participantName)}</Text>
      <Text style={paragraph}>{t.body(params.amount, params.eventTitle)}</Text>

      <Section style={infoTable}>
        <div style={infoRow}>
          <div style={infoLabel}>{t.amountLabel}</div>
          <div style={infoValue}>{params.amount}</div>
        </div>
        <div style={infoRow}>
          <div style={infoLabel}>{t.eventLabel}</div>
          <div style={infoValue}>{params.eventTitle}</div>
        </div>
        <div style={infoRow}>
          <div style={infoLabel}>{t.dateLabel}</div>
          <div style={infoValue}>{params.paymentDate}</div>
        </div>
        <div style={infoRow}>
          <div style={infoLabel}>{t.receiptIdLabel}</div>
          <div style={infoValue}>{params.receiptId}</div>
        </div>
      </Section>

      <Text style={noticeBoxSuccess}>{t.thankYou}</Text>

      <Text style={{ ...paragraph, marginTop: "24px" }}>{dict.common.signoff}</Text>
    </EmailLayout>
  );
}

export function buildPaymentReceiptEmail(
  params: PaymentReceiptParams & { locale?: Locale },
): Promise<RenderedEmail> {
  const dict = pickDict(params.locale);
  return renderEmail(
    dict.paymentReceipt.subject(params.amount),
    <PaymentReceiptEmail {...params} />,
  );
}
