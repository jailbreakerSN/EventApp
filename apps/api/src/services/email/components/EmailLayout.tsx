import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import type React from "react";
import { type Dictionary } from "../i18n";
import { config } from "@/config";

// ─── Brand tokens ─────────────────────────────────────────────────────────
// Kept inline here rather than importing from a design-tokens package —
// email HTML has to be fully self-contained (no external CSS), and inlined
// literals mean the template files are readable without chasing indirection.
// Values mirror docs/design-system — navy + gold on white.
const BRAND_NAVY = "#1A1A2E";
const BRAND_GOLD = "#D4A843";
const TEXT_PRIMARY = "#1A1A2E";
const TEXT_MUTED = "#6B7280";
const BG_PAGE = "#F5F5F0";
const BG_CARD = "#FFFFFF";
const BORDER = "#E5E7EB";

export interface EmailLayoutProps {
  /** Plain-text preview shown in inbox listings. Keep under 90 chars. */
  preview: string;
  dict: Dictionary;
  children: React.ReactNode;
  /**
   * When provided, renders an unsubscribe line in the footer with the
   * marketing-compliance copy. The actual RFC 8058 header is set at the
   * provider layer; this line is the visible backup for older clients.
   */
  unsubscribeNote?: string;
  /**
   * Phase 2.5 — opt-out of the always-on compliance footer (postal
   * address + generic unsubscribe link). Auth + billing templates set
   * this to skip the footer since those categories are mandatory.
   */
  suppressComplianceFooter?: boolean;
}

const main = { backgroundColor: BG_PAGE, margin: 0, padding: 0 };

const container = {
  backgroundColor: BG_CARD,
  margin: "0 auto",
  maxWidth: "600px",
  width: "100%",
  borderRadius: "12px",
  overflow: "hidden",
  border: `1px solid ${BORDER}`,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
};

const header = {
  backgroundColor: BRAND_NAVY,
  padding: "28px 24px",
  textAlign: "center" as const,
};

const brandText = {
  color: BRAND_GOLD,
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  letterSpacing: "-0.02em",
};

const tagline = {
  color: "#9CA3AF",
  fontSize: "12px",
  margin: "6px 0 0 0",
};

const content = {
  padding: "32px 24px",
  color: TEXT_PRIMARY,
  lineHeight: 1.55,
  fontSize: "15px",
};

const footer = {
  padding: "20px 24px 28px",
  textAlign: "center" as const,
  color: TEXT_MUTED,
  fontSize: "12px",
  lineHeight: 1.5,
};

const footerText = { margin: "0 0 8px 0", color: TEXT_MUTED, fontSize: "12px" };
const unsubscribeText = {
  margin: "12px 0 0 0",
  color: TEXT_MUTED,
  fontSize: "11px",
  lineHeight: 1.45,
};
const complianceLinkStyle = { color: TEXT_MUTED, textDecoration: "underline" };

export function EmailLayout({
  preview,
  dict,
  children,
  unsubscribeNote,
  suppressComplianceFooter,
}: EmailLayoutProps) {
  // Phase 2.5 — physical postal address + generic unsubscribe link. Gmail
  // and Yahoo bulk-sender rules require both on every non-auth / non-
  // billing send. `suppressComplianceFooter` lets the security-critical
  // templates (password reset, payment receipt, etc.) opt out; every
  // other template inherits the block automatically without a code
  // change. The signed per-recipient RFC 8058 link is still injected at
  // the provider layer for marketing sends — this is the always-visible
  // backup for older clients and the legal-compliance evidence trail.
  const postalAddress = config.RESEND_POSTAL_ADDRESS;
  const unsubscribeUrl = `${config.API_BASE_URL}/v1/notifications/unsubscribe`;
  const unsubscribeLabel =
    dict.lang === "en" ? "Unsubscribe" : dict.lang === "wo" ? "Désinscrire" : "Se désinscrire";

  return (
    // lang sourced from the dictionary so en / wo emails aren't
    // announced as French by screen readers + mail clients.
    <Html lang={dict.lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={brandText}>Teranga</Text>
            <Text style={tagline}>{dict.brand.tagline}</Text>
          </Section>
          <Section style={content}>{children}</Section>
          <Hr style={{ borderColor: BORDER, margin: 0 }} />
          <Section style={footer}>
            <Text style={footerText}>{dict.brand.footer}</Text>
            {unsubscribeNote ? <Text style={unsubscribeText}>{unsubscribeNote}</Text> : null}
            {!suppressComplianceFooter ? (
              <>
                <Text style={unsubscribeText}>{postalAddress}</Text>
                <Text style={unsubscribeText}>
                  <Link href={unsubscribeUrl} style={complianceLinkStyle}>
                    {unsubscribeLabel}
                  </Link>
                </Text>
              </>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Inline helpers reused across templates ──────────────────────────────

export const heading = {
  fontSize: "22px",
  fontWeight: 700,
  margin: "0 0 16px 0",
  color: TEXT_PRIMARY,
  lineHeight: 1.3,
};

export const headingCancelled = { ...heading, color: "#DC2626" };

export const paragraph = {
  margin: "0 0 14px 0",
  color: TEXT_PRIMARY,
  fontSize: "15px",
  lineHeight: 1.6,
};

export const infoRow = {
  display: "table-row",
};

export const infoLabel = {
  display: "table-cell",
  padding: "8px 12px 8px 0",
  color: TEXT_MUTED,
  fontSize: "14px",
  width: "35%",
};

export const infoValue = {
  display: "table-cell",
  padding: "8px 0",
  color: TEXT_PRIMARY,
  fontSize: "14px",
  fontWeight: 600,
};

export const infoTable = {
  display: "table",
  width: "100%",
  borderCollapse: "collapse" as const,
  margin: "16px 0",
};

export const ctaButton = {
  display: "inline-block",
  backgroundColor: BRAND_GOLD,
  color: "#FFFFFF",
  padding: "12px 24px",
  borderRadius: "8px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "15px",
  marginTop: "8px",
};

export const noticeBoxSuccess = {
  backgroundColor: "#F0FDF4",
  padding: "14px 16px",
  borderRadius: "8px",
  color: TEXT_PRIMARY,
  fontSize: "14px",
  margin: "16px 0 0 0",
  textAlign: "center" as const,
};

export const noticeBoxWarning = {
  backgroundColor: "#FEF3C7",
  padding: "14px 16px",
  borderRadius: "8px",
  color: TEXT_PRIMARY,
  fontSize: "14px",
  margin: "16px 0 0 0",
  textAlign: "center" as const,
  fontWeight: 600,
};

export const noticeBoxError = {
  backgroundColor: "#FEF2F2",
  padding: "14px 16px",
  borderRadius: "8px",
  borderLeft: "4px solid #DC2626",
  color: TEXT_PRIMARY,
  fontSize: "14px",
  margin: "16px 0 0 0",
};

export const noticeBoxMuted = {
  backgroundColor: "#F8F9FA",
  padding: "14px 16px",
  borderRadius: "8px",
  color: TEXT_MUTED,
  fontSize: "14px",
  margin: "16px 0 0 0",
  textAlign: "center" as const,
};
