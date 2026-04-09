"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, XCircle, Loader2, ArrowLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { eventsApi, registrationsApi } from "@/lib/api-client";
import { usePaymentStatus } from "@/hooks/use-payments";
import { Button, Card, CardContent, Spinner, formatCurrency } from "@teranga/shared-ui";
import type { Event, Payment, Registration } from "@teranga/shared-types";

export default function PaymentStatusPage() {
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

  // Fetch registration to get the signed QR code once payment succeeds
  const { data: myRegsData } = useQuery({
    queryKey: ["my-registrations-for-qr", eventId],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
    enabled: isSuccess,
  });
  const myRegs = (myRegsData as { data?: Registration[] })?.data as Registration[] | undefined;
  const registration = myRegs?.find((r) => r.eventId === eventId && r.status === "confirmed");

  // Auto-redirect to badge page on payment success
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
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted-foreground">Aucun paiement sp\u00e9cifi\u00e9.</p>
        <Link href="/events" className="mt-4 inline-block text-teranga-gold hover:underline">
          Retour aux \u00e9v\u00e9nements
        </Link>
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
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link
        href={event ? `/events/${eventId}` : "/events"}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {event ? `Retour \u00e0 ${event.title}` : "Retour aux \u00e9v\u00e9nements"}
      </Link>

      <h1 className="text-2xl font-bold">{event?.title ?? "Paiement"}</h1>

      <Card className="mt-6">
        <CardContent className="flex flex-col items-center py-8">
          {/* Processing state */}
          {!isTerminal && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/50">
                <Loader2 className="h-10 w-10 animate-spin text-amber-500 dark:text-amber-400" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Paiement en cours\u2026</h2>
              <p className="mt-2 text-center text-muted-foreground">
                Votre paiement est en cours de traitement. Cette page se met \u00e0 jour
                automatiquement.
              </p>
              {payment && (
                <p className="mt-3 text-lg font-semibold text-teranga-gold">
                  {formatCurrency(payment.amount, payment.currency)}
                </p>
              )}
            </>
          )}

          {/* Success state */}
          {isSuccess && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
                <CheckCircle className="h-10 w-10 text-teranga-green" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Paiement confirm\u00e9 !</h2>
              <p className="mt-2 text-center text-muted-foreground">
                Votre inscription a \u00e9t\u00e9 confirm\u00e9e et votre badge QR est pr\u00eat.
              </p>
              <p className="mt-3 text-lg font-semibold text-teranga-green">
                {formatCurrency(payment.amount, payment.currency)}
              </p>

              {/* Auto-redirect notice */}
              {registration && redirectCountdown !== null && redirectCountdown > 0 && (
                <p className="mt-3 text-sm text-primary animate-pulse">
                  Redirection vers votre badge dans {redirectCountdown}s...
                </p>
              )}

              {/* Show signed QR code from the registration */}
              {registration?.qrCodeValue && (
                <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
                  <QRCodeSVG value={registration.qrCodeValue} size={180} level="M" includeMargin />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                {registration && (
                  <Link href={`/my-events/${registration.id}/badge`}>
                    <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                      Voir mon badge
                    </Button>
                  </Link>
                )}
                <Link href="/my-events">
                  <Button
                    variant={registration ? "outline" : "default"}
                    className={!registration ? "bg-teranga-gold hover:bg-teranga-gold/90" : ""}
                  >
                    Mes inscriptions
                  </Button>
                </Link>
                <Link href="/events">
                  <Button variant="outline">Explorer d&apos;autres \u00e9v\u00e9nements</Button>
                </Link>
              </div>
            </>
          )}

          {/* Failed / expired state */}
          {isFailed && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Paiement \u00e9chou\u00e9</h2>
              <p className="mt-2 text-center text-muted-foreground">
                {payment.failureReason ??
                  "Le paiement n'a pas pu \u00eatre trait\u00e9. Veuillez r\u00e9essayer."}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href={`/register/${eventId}`}>
                  <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                    R\u00e9essayer
                  </Button>
                </Link>
                <Link href="/events">
                  <Button variant="outline">Retour aux \u00e9v\u00e9nements</Button>
                </Link>
              </div>
            </>
          )}

          {/* Error state */}
          {isError && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Erreur</h2>
              <p className="mt-2 text-center text-muted-foreground">
                Impossible de r\u00e9cup\u00e9rer le statut du paiement.
              </p>
              <Link href="/events" className="mt-4">
                <Button variant="outline">Retour aux \u00e9v\u00e9nements</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
