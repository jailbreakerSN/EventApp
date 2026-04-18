"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, XCircle, Loader2, ArrowLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { eventsApi, registrationsApi } from "@/lib/api-client";
import { usePaymentStatus } from "@/hooks/use-payments";
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

export default function PaymentStatusPage() {
  const t = useTranslations("paymentStatus");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const paymentId = searchParams.get("paymentId");

  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

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
          kicker="— PAIEMENT"
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
        href={event ? `/events/${eventId}` : "/events"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {event ? t("backToEventPrefix", { title: event.title }) : t("backToEvents")}
      </Link>

      <SectionHeader
        kicker="— PAIEMENT"
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
              <h2 className="mt-4 text-xl font-bold">{t("processingHeading")}</h2>
              <p className="mt-2 text-center text-muted-foreground">{t("processingHint")}</p>
              {payment && (
                <p className="mt-3 text-lg font-semibold text-teranga-gold">
                  {formatCurrency(payment.amount, payment.currency, regional)}
                </p>
              )}
            </>
          )}

          {isSuccess && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
                <CheckCircle className="h-10 w-10 text-teranga-green" />
              </div>
              <h2 className="mt-4 text-xl font-bold">{t("successHeading")}</h2>
              <p className="mt-2 text-center text-muted-foreground">{t("successHint")}</p>
              <p className="mt-3 text-lg font-semibold text-teranga-green">
                {formatCurrency(payment.amount, payment.currency, regional)}
              </p>

              {registration && redirectCountdown !== null && redirectCountdown > 0 && (
                <p className="mt-3 text-sm text-primary animate-pulse">
                  {t("redirectIn", { seconds: redirectCountdown })}
                </p>
              )}

              {registration?.qrCodeValue && (
                <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
                  <QRCodeSVG value={registration.qrCodeValue} size={180} level="M" includeMargin />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                {registration && (
                  <Link href={`/my-events/${registration.id}/badge`}>
                    <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                      {t("viewBadge")}
                    </Button>
                  </Link>
                )}
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
            </>
          )}

          {isFailed && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
              </div>
              <h2 className="mt-4 text-xl font-bold">{t("failedHeading")}</h2>
              <p className="mt-2 text-center text-muted-foreground">
                {payment.failureReason ?? t("failedFallback")}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href={`/register/${eventId}`}>
                  <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                    {t("retry")}
                  </Button>
                </Link>
                <Link href="/events">
                  <Button variant="outline">{t("backToEvents")}</Button>
                </Link>
              </div>
            </>
          )}

          {isError && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
              </div>
              <h2 className="mt-4 text-xl font-bold">{t("errorHeading")}</h2>
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
