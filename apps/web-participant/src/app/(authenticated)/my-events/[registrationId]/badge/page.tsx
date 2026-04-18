"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { ArrowLeft, Download, Loader2, AlertTriangle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { registrationsApi, badgesApi } from "@/lib/api-client";
import { cacheBadgeInServiceWorker } from "@/hooks/use-badges";
import { useAuth } from "@/hooks/use-auth";
import {
  Button,
  EmptyStateEditorial,
  SectionHeader,
  Spinner,
  TicketPass,
  formatDate,
} from "@teranga/shared-ui";
import type { Registration, GeneratedBadge } from "@teranga/shared-types";
import { intlLocale } from "@/lib/intl-locale";

export default function BadgePage() {
  const t = useTranslations("badge");
  const tSuccess = useTranslations("registerFlow.success");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { user } = useAuth();
  const { registrationId } = useParams<{ registrationId: string }>();
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");

  const { data: regData, isLoading } = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
  });

  const registrations = (regData as { data?: Registration[] })?.data as Registration[] | undefined;
  const registration = registrations?.find((r) => r.id === registrationId);

  const handleDownloadPdf = async () => {
    if (!registration?.eventId || pdfState === "loading") return;
    setPdfState("loading");
    try {
      const res = await badgesApi.getMyBadge(registration.eventId);
      const badge = (res as { data?: GeneratedBadge })?.data as GeneratedBadge | undefined;
      if (badge?.pdfURL) {
        cacheBadgeInServiceWorker(`/v1/badges/me/${registration.eventId}`);
        window.open(badge.pdfURL, "_blank");
        setPdfState("idle");
      } else {
        setPdfState("error");
      }
    } catch {
      setPdfState("error");
    }
  };

  useEffect(() => {
    if (registration?.eventId) {
      cacheBadgeInServiceWorker(`/v1/badges/me/${registration.eventId}`);
    }
  }, [registration?.eventId]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!registration) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— INTROUVABLE"
          title={t("registrationNotFound")}
          action={
            <Link
              href="/my-events"
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              {t("backToMyEvents")}
            </Link>
          }
        />
      </div>
    );
  }

  const isConfirmed = registration.status === "confirmed" || registration.status === "checked_in";
  const holderName =
    registration.participantName ?? user?.displayName ?? user?.email ?? "";

  const passFields = [
    { label: tSuccess("dateLabel"), value: formatDate(registration.createdAt, regional) },
    { label: tSuccess("passTypeLabel"), value: registration.ticketTypeName ?? "—" },
    ...(holderName
      ? [{ label: tSuccess("placeLabel"), value: holderName.split(" ")[0] }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-xl px-6 pt-10 pb-16 lg:px-8 space-y-6">
      <Link
        href="/my-events"
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t("backToMyEvents")}
      </Link>

      <SectionHeader kicker="— BADGE" title={t("title")} size="hero" as="h1" />

      {/* Editorial navy pass — shared editorial primitive, same gradient
          tint + perforation + QR panel + offline strip as the prototype
          BadgeModal treatment in my-events.jsx. */}
      {registration.qrCodeValue ? (
        <TicketPass
          className="mt-8"
          coverKey={registration.eventId}
          kicker={tSuccess("passLabel")}
          eventTitle={registration.eventTitle ?? registration.eventId}
          fields={passFields}
          qr={
            <QRCodeSVG
              value={registration.qrCodeValue}
              size={210}
              level="M"
              includeMargin={false}
            />
          }
          codeLabel={tSuccess("codeLabel")}
          codeValue={registration.qrCodeValue.slice(0, 24)}
          holderLine={holderName ? `${holderName} · ${registration.ticketTypeName ?? ""}` : undefined}
          validAccessLabel={tSuccess("accessValid")}
          scanHint={t("scanToCheckin")}
          offlineHint={`⚡ ${t("offlineHint")}`}
          footerVariant="stack"
          animateReveal
        />
      ) : (
        <div className="mt-8 overflow-hidden rounded-pass bg-teranga-navy px-6 py-10 text-center text-white/70">
          {t("notYetAvailable")}
        </div>
      )}

      {/* Actions */}
      {isConfirmed && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={pdfState === "loading"}
            aria-label={t("downloadPdfAria")}
            className="rounded-full"
          >
            {pdfState === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {pdfState === "loading" ? t("generatingPdf") : t("downloadPdf")}
          </Button>
          {pdfState === "error" && (
            <p className="text-center text-sm text-muted-foreground">{t("pdfError")}</p>
          )}
        </div>
      )}
    </div>
  );
}

