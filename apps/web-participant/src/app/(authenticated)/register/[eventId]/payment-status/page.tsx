"use client";

import { useParams, useSearchParams } from "next/navigation";
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
  const paymentId = searchParams.get("paymentId");

  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getById(eventId),
  });

  const { data: paymentData, isLoading, isError } = usePaymentStatus(paymentId);

  const event = (eventData as { data?: Event })?.data as Event | undefined;
  const payment = (paymentData as { data?: Payment })?.data as Payment | undefined;

  const status = payment?.status;
  const isTerminal = status === "succeeded" || status === "failed" || status === "refunded" || status === "expired";
  const isSuccess = status === "succeeded";

  // Fetch registration to get the signed QR code once payment succeeds
  const { data: myRegsData } = useQuery({
    queryKey: ["my-registrations-for-qr", eventId],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
    enabled: isSuccess,
  });
  const myRegs = (myRegsData as { data?: Registration[] })?.data as Registration[] | undefined;
  const registration = myRegs?.find((r) => r.eventId === eventId && r.status === "confirmed");

  if (!paymentId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted-foreground">Aucun paiement spécifié.</p>
        <Link href="/events" className="mt-4 inline-block text-teranga-gold hover:underline">
          Retour aux événements
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
        {event ? `Retour à ${event.title}` : "Retour aux événements"}
      </Link>

      <h1 className="text-2xl font-bold">{event?.title ?? "Paiement"}</h1>

      <Card className="mt-6">
        <CardContent className="flex flex-col items-center py-8">
          {/* Processing state */}
          {!isTerminal && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
                <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Paiement en cours…</h2>
              <p className="mt-2 text-center text-muted-foreground">
                Votre paiement est en cours de traitement. Cette page se met à jour automatiquement.
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
              <h2 className="mt-4 text-xl font-bold">Paiement confirmé !</h2>
              <p className="mt-2 text-center text-muted-foreground">
                Votre inscription a été confirmée et votre badge QR est prêt.
              </p>
              <p className="mt-3 text-lg font-semibold text-teranga-green">
                {formatCurrency(payment.amount, payment.currency)}
              </p>

              {/* Show signed QR code from the registration */}
              {registration?.qrCodeValue && (
                <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
                  <QRCodeSVG
                    value={registration.qrCodeValue}
                    size={180}
                    level="M"
                    includeMargin
                  />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/my-events">
                  <Button className="bg-teranga-gold hover:bg-teranga-gold/90">Mes inscriptions</Button>
                </Link>
                <Link href="/events">
                  <Button variant="outline">Explorer d&apos;autres événements</Button>
                </Link>
              </div>
            </>
          )}

          {/* Failed / expired state */}
          {isTerminal && !isSuccess && payment && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                <XCircle className="h-10 w-10 text-red-500" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Paiement échoué</h2>
              <p className="mt-2 text-center text-muted-foreground">
                {payment.failureReason ?? "Le paiement n'a pas pu être traité. Veuillez réessayer."}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href={`/register/${eventId}`}>
                  <Button className="bg-teranga-gold hover:bg-teranga-gold/90">Réessayer</Button>
                </Link>
                <Link href="/events">
                  <Button variant="outline">Retour aux événements</Button>
                </Link>
              </div>
            </>
          )}

          {/* Error state */}
          {isError && (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                <XCircle className="h-10 w-10 text-red-500" />
              </div>
              <h2 className="mt-4 text-xl font-bold">Erreur</h2>
              <p className="mt-2 text-center text-muted-foreground">
                Impossible de récupérer le statut du paiement.
              </p>
              <Link href="/events" className="mt-4">
                <Button variant="outline">Retour aux événements</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
