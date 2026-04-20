"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, CheckCircle2, Download, Loader2, AlertTriangle, WifiOff } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { registrationsApi, badgesApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import {
  Button,
  EmptyStateEditorial,
  SectionHeader,
  Spinner,
  TicketPass,
  formatDate,
} from "@teranga/shared-ui";
import type { Registration } from "@teranga/shared-types";
import { intlLocale } from "@/lib/intl-locale";
import { loadBadge, saveBadge, type CachedBadge } from "@/lib/badge-store";

type OfflineState = "idle" | "saving" | "saved" | "error";

export default function BadgePage() {
  const t = useTranslations("badge");
  const tSuccess = useTranslations("registerFlow.success");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { user } = useAuth();
  const { registrationId } = useParams<{ registrationId: string }>();
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");
  const [offlineState, setOfflineState] = useState<OfflineState>("idle");
  const [cachedBadge, setCachedBadge] = useState<CachedBadge | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const { data: regData, isLoading } = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
    retry: false,
  });

  const networkRegistrations = (regData as { data?: Registration[] })?.data as
    | Registration[]
    | undefined;
  const networkRegistration = networkRegistrations?.find((r) => r.id === registrationId);

  // Merge live API data with the IDB fallback: if the network query failed
  // or returned nothing, fall back to the cached badge that was stashed
  // during a previous online visit.
  const registration: Registration | undefined = useMemo(() => {
    if (networkRegistration) return networkRegistration;
    if (!cachedBadge) return undefined;
    return {
      id: cachedBadge.registrationId,
      eventId: cachedBadge.eventId,
      userId: user?.uid ?? "",
      ticketTypeId: "",
      eventTitle: cachedBadge.eventTitle,
      ticketTypeName: cachedBadge.ticketTypeName,
      participantName: cachedBadge.holderName,
      participantEmail: user?.email ?? null,
      status: "confirmed",
      qrCodeValue: cachedBadge.qrCodeValue,
      checkedInAt: null,
      checkedInBy: null,
      accessZoneId: null,
      notes: null,
      createdAt: cachedBadge.cachedAt,
      updatedAt: cachedBadge.cachedAt,
    } as Registration;
  }, [networkRegistration, cachedBadge, user?.uid, user?.email]);

  // Load any previously-cached version on mount so the page renders even if
  // the registrations list failed (offline, Firebase quota, etc.).
  useEffect(() => {
    if (!registrationId) return;
    loadBadge(registrationId).then((cached) => {
      if (cached) setCachedBadge(cached);
    });
  }, [registrationId]);

  // Track connectivity so we can surface the "loaded from cache" notice
  // when the user is offline but a cached badge is available.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Persist the QR payload to IndexedDB the moment we have it from the
  // network. Silent best-effort — any failure leaves the UI unaffected.
  useEffect(() => {
    if (!networkRegistration?.qrCodeValue) return;
    saveBadge({
      registrationId: networkRegistration.id,
      qrCodeValue: networkRegistration.qrCodeValue,
      eventId: networkRegistration.eventId,
      eventTitle: networkRegistration.eventTitle ?? networkRegistration.eventId,
      holderName: networkRegistration.participantName ?? user?.displayName ?? user?.email ?? "",
      ticketTypeName: networkRegistration.ticketTypeName ?? "",
      cachedAt: new Date().toISOString(),
    });
    // Keep the in-memory cached-badge mirror in sync so the offline chip
    // reflects the current state without a round-trip.
    setCachedBadge({
      registrationId: networkRegistration.id,
      qrCodeValue: networkRegistration.qrCodeValue,
      eventId: networkRegistration.eventId,
      eventTitle: networkRegistration.eventTitle ?? networkRegistration.eventId,
      holderName: networkRegistration.participantName ?? user?.displayName ?? user?.email ?? "",
      ticketTypeName: networkRegistration.ticketTypeName ?? "",
      cachedAt: new Date().toISOString(),
    });
  }, [networkRegistration, user?.displayName, user?.email]);

  const handleSaveOffline = async () => {
    if (!registration?.eventId || offlineState === "saving") return;
    setOfflineState("saving");
    try {
      // Two independent caches — never couple them. The QR payload is the
      // authoritative credential and is already in IndexedDB by the time
      // this handler runs (stashed by the effect above on first fetch);
      // `getMyBadge()` re-ups it and `getMyBadgePdf()` warms the Service
      // Worker's PDF cache. If the PDF fetch fails the participant still
      // walks into the venue — the scanner only needs the QR value that
      // lives in IndexedDB.
      //
      // Issue both fetches through the app (with auth) so the SW's fetch
      // handler caches the responses. The postMessage-based CACHE_BADGE
      // path can't reach auth-gated routes — the SW would call fetch(url)
      // without the Bearer token.
      await Promise.all([
        badgesApi.getMyBadge(registration.eventId),
        badgesApi.getMyBadgePdf(registration.eventId),
      ]);
      setOfflineState("saved");
    } catch {
      setOfflineState("error");
    }
  };

  const handleDownloadPdf = async () => {
    if (!registration?.eventId || pdfState === "loading") return;
    setPdfState("loading");
    try {
      const blob = await badgesApi.getMyBadgePdf(registration.eventId);
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank");
      // Object URLs leak memory if held forever; revoke after the new tab
      // has had time to load. 60s is generous on slow networks but bounded.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setPdfState("idle");
    } catch {
      setPdfState("error");
    }
  };

  if (isLoading && !cachedBadge) {
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
  const holderName = registration.participantName ?? user?.displayName ?? user?.email ?? "";

  const passFields = [
    { label: tSuccess("dateLabel"), value: formatDate(registration.createdAt, regional) },
    { label: tSuccess("passTypeLabel"), value: registration.ticketTypeName ?? "—" },
    ...(holderName ? [{ label: tSuccess("placeLabel"), value: holderName.split(" ")[0] }] : []),
  ];

  const isServedFromCache = !networkRegistration && !!cachedBadge;
  const hasOfflineCopy = !!cachedBadge || offlineState === "saved";

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

      {/* Offline-from-cache notice — only shows when we're rendering from
          IndexedDB because the network failed. Keeps the participant
          confident the QR is still the right one. */}
      {isOffline && isServedFromCache && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-card border border-teranga-gold/30 bg-teranga-gold/5 px-4 py-2.5 text-sm text-teranga-gold-dark dark:border-teranga-gold/40 dark:bg-teranga-gold/15"
        >
          <WifiOff className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>{t("cachedNotice")}</span>
        </div>
      )}

      {/* Persistent "Saved offline" chip — independent of current network
          state. Makes the core differentiator visible at all times. */}
      {hasOfflineCopy && (
        <div className="flex items-center gap-2 text-xs font-medium text-teranga-green">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>⚡ {t("savedOfflineChip")}</span>
        </div>
      )}

      {/* Editorial navy pass — shared editorial primitive, same gradient
          tint + perforation + QR panel + offline strip as the prototype
          BadgeModal treatment in my-events.jsx. */}
      {registration.qrCodeValue ? (
        <TicketPass
          className="mt-4"
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
          holderLine={
            holderName ? `${holderName} · ${registration.ticketTypeName ?? ""}` : undefined
          }
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

      {/* Actions — primary: save for offline, secondary: download PDF. */}
      {isConfirmed && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            onClick={handleSaveOffline}
            disabled={offlineState === "saving"}
            aria-label={t("saveOfflineAria")}
            className="rounded-full bg-teranga-gold text-teranga-navy hover:bg-teranga-gold/90 dark:bg-teranga-gold-light dark:text-teranga-navy dark:hover:bg-teranga-gold"
          >
            {offlineState === "saving" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {offlineState === "saving"
              ? t("savingOffline")
              : offlineState === "saved"
                ? t("savedOfflineChip")
                : t("saveOffline")}
          </Button>

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

          {/* Screen-reader + toast channel for the async save result. */}
          <span role="status" aria-live="polite" className="sr-only">
            {offlineState === "saved" ? t("savedOfflineToast") : ""}
          </span>
          {offlineState === "saved" && (
            <p className="text-center text-sm font-medium text-teranga-green">
              {t("savedOfflineToast")}
            </p>
          )}
          {offlineState === "error" && (
            <p className="text-center text-sm text-destructive">{t("saveOfflineError")}</p>
          )}
          {pdfState === "error" && (
            <p className="text-center text-sm text-muted-foreground">{t("pdfError")}</p>
          )}
        </div>
      )}
    </div>
  );
}
