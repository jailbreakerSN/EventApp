"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Download, Loader2, XCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { eventsApi, receiptsApi, registrationsApi } from "@/lib/api-client";
import { usePaymentStatus, useVerifyPayment } from "@/hooks/use-payments";
import {
  Button,
  Card,
  CardContent,
  EmptyStateEditorial,
  SectionHeader,
  Spinner,
  formatCurrency,
} from "@teranga/shared-ui";
import type { Event, Payment, Registration } from "@teranga/shared-types";
import { intlLocale } from "@/lib/intl-locale";

export default function PaymentStatusPage() {
  const t = useTranslations("paymentStatus");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const paymentId = searchParams.get("paymentId");

  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [receiptState, setReceiptState] = useState<"idle" | "loading" | "error">("idle");

  // ADR-0018 — Verify-on-return state machine
  // ─────────────────────────────────────────
  // The page may be reached via three paths:
  //   1. PayDunya redirect-back → fire verify ONCE on mount (the
  //      common case; resolves the flow in <1 s without waiting on
  //      the 3 s polling tick).
  //   2. User reload of an in-flight tab → mount fires verify AGAIN;
  //      the API short-circuits if the Payment is already terminal,
  //      so this is cheap.
  //   3. User clicks "Vérifier maintenant" → manual re-trigger when
  //      polling has been stuck on `processing` for too long (gives
  //      the participant a sense of agency rather than a frozen
  //      spinner).
  //
  // `mountVerifyDoneRef` guards the auto-verify against React Strict
  // Mode's double-mount in dev; the manual button bypasses the ref
  // by calling the mutation directly.
  const verifyMutation = useVerifyPayment();
  const mountVerifyDoneRef = useRef(false);
  const [verifyOutcome, setVerifyOutcome] = useState<
    "idle" | "verifying" | "succeeded" | "failed" | "pending" | "error"
  >("idle");

  const handleReceiptDownload = async () => {
    if (!paymentId || receiptState === "loading") return;
    setReceiptState("loading");
    try {
      // generate() is idempotent on the API side — returns existing receipt
      // if one already exists, so calling it every click is safe.
      const gen = (await receiptsApi.generate(paymentId)) as {
        data?: { id?: string };
      };
      const receiptId = gen?.data?.id;
      if (!receiptId) {
        setReceiptState("error");
        return;
      }
      const pdf = (await receiptsApi.getPdf(receiptId)) as {
        data?: { pdfURL?: string };
      };
      const url = pdf?.data?.pdfURL;
      if (!url) {
        setReceiptState("error");
        return;
      }
      window.open(url, "_blank");
      setReceiptState("idle");
    } catch {
      setReceiptState("error");
    }
  };

  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getById(eventId),
  });

  const { data: paymentData, isLoading, isError } = usePaymentStatus(paymentId);

  const event = (eventData as { data?: Event })?.data as Event | undefined;
  const payment = (paymentData as { data?: Payment })?.data as Payment | undefined;

  const status = payment?.status;
  const isTerminal =
    status === "succeeded" || status === "failed" || status === "refunded" || status === "expired";
  const isSuccess = status === "succeeded";
  const isFailed = isTerminal && !isSuccess;

  // ADR-0018 — verify-on-mount. Fires exactly once per page mount as
  // a fast finalisation path that doesn't wait on the IPN webhook.
  // Skipped when:
  //   - paymentId missing (no-op page)
  //   - polling already reported a terminal state (verify is no-op)
  // The mutation itself is server-side idempotent — chatty remounts
  // won't cascade into provider quota.
  useEffect(() => {
    if (!paymentId) return;
    if (mountVerifyDoneRef.current) return;
    if (isTerminal) {
      // Already terminal from polling — no need to ping the provider.
      mountVerifyDoneRef.current = true;
      return;
    }
    mountVerifyDoneRef.current = true;
    setVerifyOutcome("verifying");
    verifyMutation
      .mutateAsync(paymentId)
      .then((res) => {
        const outcome =
          (res as { data?: { outcome?: "succeeded" | "failed" | "pending" } })?.data?.outcome ??
          "pending";
        setVerifyOutcome(outcome);
      })
      .catch(() => {
        // Non-fatal — fall back to the polling path. Surface a
        // discreet error state so the manual retry button shows.
        setVerifyOutcome("error");
      });
    // `mountVerifyDoneRef` is the load-bearing idempotency guard:
    // every re-run of this effect (e.g. when polling flips `isTerminal`
    // false → true) returns early because the ref was set on the first
    // mount. Including `isTerminal` + `verifyMutation` in deps is
    // therefore safe AND satisfies react-hooks/exhaustive-deps without
    // needing a disable comment (the project's ESLint config doesn't
    // register the rule, so the disable comment itself triggers
    // "rule definition not found").
  }, [paymentId, isTerminal, verifyMutation]);

  const handleManualVerify = () => {
    if (!paymentId || verifyMutation.isPending) return;
    setVerifyOutcome("verifying");
    verifyMutation
      .mutateAsync(paymentId)
      .then((res) => {
        const outcome =
          (res as { data?: { outcome?: "succeeded" | "failed" | "pending" } })?.data?.outcome ??
          "pending";
        setVerifyOutcome(outcome);
      })
      .catch(() => setVerifyOutcome("error"));
  };

  const { data: myRegsData } = useQuery({
    queryKey: ["my-registrations-for-qr", eventId],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
    enabled: isSuccess,
  });
  const myRegs = (myRegsData as { data?: Registration[] })?.data as Registration[] | undefined;
  const registration = myRegs?.find((r) => r.eventId === eventId && r.status === "confirmed");

  useEffect(() => {
    if (!isSuccess || !registration) return;

    setRedirectCountdown(3);

    const interval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          router.push(`/my-events/${registration.id}/badge`);
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);

    return () => clearInterval(interval);
  }, [isSuccess, registration, router]);

  if (!paymentId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyStateEditorial
          icon={XCircle}
          kicker={t("kicker")}
          title={t("noPaymentSpecified")}
          action={
            <Link
              href="/events"
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              {t("backToEvents")}
            </Link>
          }
        />
      </div>
    );
  }

  if (isLoading && !payment) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-6">
      <Link
        href={event ? `/events/${event.slug}` : "/events"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {event ? t("backToEventPrefix", { title: event.title }) : t("backToEvents")}
      </Link>

      <SectionHeader
        kicker={t("kicker")}
        title={event?.title ?? t("pageTitleFallback")}
        size="hero"
        as="h1"
      />

      <Card>
        <CardContent className="flex flex-col items-center py-8">
          {!isTerminal && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/50">
                <Loader2 className="h-10 w-10 animate-spin text-amber-500 dark:text-amber-400" />
              </div>
              <h2 className="font-serif-display mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em]">
                {t("processingHeading")}
              </h2>
              <p className="mt-2 text-center text-muted-foreground">
                {/* ADR-0018 — copy adapts to the verify-on-return state.
                    "verifying" tells the user we're actively asking the
                    provider; "pending" tells them we're falling back to
                    polling; default is the original idle hint. */}
                {verifyOutcome === "verifying"
                  ? t("verifyingHint")
                  : verifyOutcome === "pending"
                    ? t("pollingFallbackHint")
                    : verifyOutcome === "error"
                      ? t("verifyErrorHint")
                      : t("processingHint")}
              </p>
              {payment && (
                <p className="mt-3 text-lg font-semibold text-teranga-gold">
                  {formatCurrency(payment.amount, payment.currency, regional)}
                </p>
              )}
              {/* Manual re-verify button — appears when the auto-verify
                  was inconclusive ("pending" / "error") so the user has
                  agency. Hidden during the initial verify-on-mount to
                  avoid a flash of the button. */}
              {(verifyOutcome === "pending" || verifyOutcome === "error") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualVerify}
                  disabled={verifyMutation.isPending}
                  aria-label={t("verifyNowAria")}
                  className="mt-5 rounded-full"
                >
                  {verifyMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {t("verifyNow")}
                </Button>
              )}
            </>
          )}

          {isSuccess && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
                <CheckCircle className="h-10 w-10 text-teranga-green" />
              </div>
              <h2 className="font-serif-display mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em]">{t("successHeading")}</h2>
              <p className="mt-2 text-center text-muted-foreground">{t("successHint")}</p>
              <p className="mt-3 text-lg font-semibold text-teranga-green">
                {formatCurrency(payment.amount, payment.currency, regional)}
              </p>

              {registration && redirectCountdown !== null && redirectCountdown > 0 && (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-3 text-sm text-primary animate-pulse"
                >
                  {t("redirectIn", { seconds: redirectCountdown })}
                </p>
              )}

              {registration?.qrCodeValue && (
                <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
                  <QRCodeSVG value={registration.qrCodeValue} size={180} level="M" includeMargin />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
                {registration && (
                  <Link href={`/my-events/${registration.id}/badge`}>
                    <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                      {t("viewBadge")}
                    </Button>
                  </Link>
                )}
                <Button
                  variant="outline"
                  onClick={handleReceiptDownload}
                  disabled={receiptState === "loading"}
                >
                  {receiptState === "loading" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {receiptState === "loading"
                    ? t("generatingReceipt")
                    : t("downloadReceipt")}
                </Button>
                <Link href="/my-events">
                  <Button
                    variant={registration ? "outline" : "default"}
                    className={!registration ? "bg-teranga-gold hover:bg-teranga-gold/90" : ""}
                  >
                    {t("myRegistrations")}
                  </Button>
                </Link>
                <Link href="/events">
                  <Button variant="outline">{t("exploreOthers")}</Button>
                </Link>
              </div>
              {receiptState === "error" && (
                <p className="mt-2 text-center text-sm text-destructive">
                  {t("receiptError")}
                </p>
              )}
            </>
          )}

          {isFailed && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
              </div>
              <h2 className="font-serif-display mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em]">{t("failedHeading")}</h2>
              <p className="mt-2 text-center text-muted-foreground">
                {payment.failureReason ?? t("failedFallback")}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href={`/register/${eventId}`}>
                  <Button className="bg-teranga-gold hover:bg-teranga-gold/90">{t("retry")}</Button>
                </Link>
                <a href="mailto:contact@teranga.sn?subject=Paiement%20%C3%A9chou%C3%A9">
                  <Button variant="outline">{t("contactSupport")}</Button>
                </a>
                <Link href="/events">
                  <Button variant="ghost">{t("backToEvents")}</Button>
                </Link>
              </div>
            </>
          )}

          {isError && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
              </div>
              <h2 className="font-serif-display mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em]">{t("errorHeading")}</h2>
              <p className="mt-2 text-center text-muted-foreground">{t("errorHint")}</p>
              <Link href="/events" className="mt-4">
                <Button variant="outline">{t("backToEvents")}</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
