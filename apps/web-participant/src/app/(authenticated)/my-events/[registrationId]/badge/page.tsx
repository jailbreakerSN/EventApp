"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { registrationsApi, badgesApi } from "@/lib/api-client";
import { cacheBadgeInServiceWorker } from "@/hooks/use-badges";
import { useAuth } from "@/hooks/use-auth";
import { Button, Spinner, formatDate } from "@teranga/shared-ui";
import type { Registration, GeneratedBadge } from "@teranga/shared-types";
import { getCoverGradient } from "@/lib/cover-gradient";

function intlLocale(locale: string): string {
  switch (locale) {
    case "fr":
      return "fr-SN";
    case "en":
      return "en-SN";
    case "wo":
      return "wo-SN";
    default:
      return locale;
  }
}

export default function BadgePage() {
  const t = useTranslations("badge");
  const tSuccess = useTranslations("registerFlow.success");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { user } = useAuth();
  const { registrationId } = useParams<{ registrationId: string }>();
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 150);
    return () => clearTimeout(t);
  }, []);

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
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-muted-foreground">{t("registrationNotFound")}</p>
        <Link
          href="/my-events"
          className="mt-4 inline-block text-teranga-gold-dark hover:underline"
        >
          {t("backToMyEvents")}
        </Link>
      </div>
    );
  }

  const isConfirmed = registration.status === "confirmed" || registration.status === "checked_in";
  const tint = getCoverGradient(registration.eventId).tint;
  const holderName =
    registration.participantName ?? user?.displayName ?? user?.email ?? "";

  return (
    <div className="mx-auto max-w-[560px] px-6 pt-10 pb-16 lg:px-8">
      <Link
        href="/my-events"
        className="mb-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t("backToMyEvents")}
      </Link>

      <h1 className="font-serif-display text-3xl font-semibold tracking-[-0.02em]">
        {t("title")}
      </h1>

      {/* Editorial navy pass — rounded-pass, gradient tint header,
          perforation notches, QR panel. Mirrors the prototype's
          BadgeModal treatment (my-events.jsx). */}
      <div
        className="mt-8 overflow-hidden rounded-pass bg-teranga-navy text-white shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] transition-all duration-500"
        style={{
          transform: revealed ? "translateY(0) scale(1)" : "translateY(16px) scale(0.98)",
          opacity: revealed ? 1 : 0,
        }}
      >
        {/* Gradient header — uses the event's rotated tint */}
        <div
          className="relative px-7 pb-5 pt-7"
          style={{
            background: `linear-gradient(135deg, ${tint} 0%, #1A1A2E 120%)`,
            borderBottom: "1px dashed rgba(255,255,255,.25)",
          }}
        >
          <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.18em] text-white/85">
            {tSuccess("passLabel")}
          </p>
          <p className="font-serif-display mt-4 text-balance text-[26px] font-semibold leading-[1.05] tracking-[-0.02em]">
            {registration.eventTitle ?? registration.eventId}
          </p>
          <div className="mt-5 flex gap-6 text-left">
            <PassField
              label={tSuccess("dateLabel")}
              value={formatDate(registration.createdAt, regional)}
            />
            <PassField
              label={tSuccess("passTypeLabel")}
              value={registration.ticketTypeName ?? "—"}
            />
            {holderName && (
              <PassField label={tSuccess("placeLabel")} value={holderName.split(" ")[0]} />
            )}
          </div>
          <span
            aria-hidden="true"
            className="absolute -bottom-2.5 -left-2.5 h-5 w-5 rounded-full bg-background"
          />
          <span
            aria-hidden="true"
            className="absolute -bottom-2.5 -right-2.5 h-5 w-5 rounded-full bg-background"
          />
        </div>

        {/* QR panel */}
        <div className="flex flex-col items-center px-6 py-7">
          {registration.qrCodeValue ? (
            <div className="rounded-[14px] bg-white p-2.5">
              <QRCodeSVG
                value={registration.qrCodeValue}
                size={210}
                level="M"
                includeMargin={false}
              />
            </div>
          ) : (
            <p className="text-center text-white/70">{t("notYetAvailable")}</p>
          )}

          {registration.qrCodeValue && (
            <>
              <p className="font-mono-kicker mt-5 text-[11px] tracking-[0.1em] text-white/60">
                {registration.qrCodeValue.slice(0, 24)}
              </p>
              {holderName && (
                <p className="mt-2 text-[13px] text-white/80">
                  {holderName} · {registration.ticketTypeName ?? ""}
                </p>
              )}
              <span className="mt-5 inline-flex items-center rounded-full bg-teranga-gold px-2.5 py-0.5 text-[10px] font-bold tracking-[0.04em] text-teranga-navy">
                {tSuccess("accessValid")}
              </span>
              <p className="mt-5 text-center text-[11px] text-white/60">
                {t("scanToCheckin")}
              </p>
            </>
          )}
        </div>

        {/* Offline hint */}
        <div className="border-t border-white/10 bg-white/[0.02] px-6 py-3.5 text-center text-[11px] text-white/60">
          ⚡ {t("offlineHint")}
        </div>
      </div>

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

function PassField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono-kicker text-[9px] font-medium uppercase tracking-[0.12em] text-white/60">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-semibold">{value}</p>
    </div>
  );
}
