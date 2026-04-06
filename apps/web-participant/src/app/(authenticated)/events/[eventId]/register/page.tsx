"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, ArrowLeft, Ticket } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { eventsApi } from "@/lib/api-client";
import { useRegister } from "@/hooks/use-registrations";
import { Button, Card, CardHeader, CardTitle, CardContent, Spinner, Badge, formatCurrency } from "@teranga/shared-ui";
import type { Event, TicketType, Registration } from "@teranga/shared-types";

type Step = "select" | "confirm" | "success";

export default function RegisterPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);

  const { data: eventData, isLoading: eventLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getById(eventId),
  });

  const registerMutation = useRegister();

  const event = (eventData as { data?: Event })?.data as Event | undefined;

  const handleConfirm = async () => {
    if (!selectedTicket) return;
    try {
      const result = await registerMutation.mutateAsync({
        eventId,
        ticketTypeId: selectedTicket.id,
      });
      setRegistration((result as { data?: Registration })?.data as Registration);
      setStep("success");
    } catch {
      // Error handled by mutation state
    }
  };

  if (eventLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted-foreground">Événement introuvable.</p>
        <Link href="/events" className="mt-4 inline-block text-teranga-gold hover:underline">
          Retour aux événements
        </Link>
      </div>
    );
  }

  const visibleTickets = event.ticketTypes.filter((t) => t.isVisible);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      {/* Back link */}
      <button
        onClick={() => step === "select" ? router.back() : setStep("select")}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {step === "success" ? "Retour" : "Retour à l'événement"}
      </button>

      <h1 className="text-2xl font-bold">{event.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Inscription</p>

      {/* Step 1: Select ticket */}
      {step === "select" && (
        <div className="mt-6 space-y-3">
          <h2 className="text-lg font-semibold">Choisissez votre billet</h2>
          {visibleTickets.map((ticket) => {
            const remaining = ticket.totalQuantity ? ticket.totalQuantity - ticket.soldCount : null;
            const soldOut = remaining !== null && remaining <= 0;

            return (
              <button
                key={ticket.id}
                disabled={soldOut}
                onClick={() => { setSelectedTicket(ticket); setStep("confirm"); }}
                className={`w-full rounded-lg border p-4 text-left transition-colors ${
                  soldOut
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-teranga-gold hover:bg-teranga-gold/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-teranga-gold" />
                    <span className="font-medium">{ticket.name}</span>
                  </div>
                  <span className="font-semibold text-teranga-gold">
                    {ticket.price === 0 ? "Gratuit" : formatCurrency(ticket.price, ticket.currency)}
                  </span>
                </div>
                {ticket.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{ticket.description}</p>
                )}
                {soldOut && <Badge variant="destructive" className="mt-2">Épuisé</Badge>}
                {remaining !== null && !soldOut && (
                  <p className="mt-1 text-xs text-muted-foreground">{remaining} place{remaining > 1 ? "s" : ""} restante{remaining > 1 ? "s" : ""}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Step 2: Confirm */}
      {step === "confirm" && selectedTicket && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Confirmer votre inscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{selectedTicket.name}</span>
                <span className="font-semibold text-teranga-gold">
                  {selectedTicket.price === 0 ? "Gratuit" : formatCurrency(selectedTicket.price, selectedTicket.currency)}
                </span>
              </div>
            </div>

            {event.requiresApproval && (
              <p className="text-sm text-amber-600">
                Cette inscription est soumise à l&apos;approbation de l&apos;organisateur.
              </p>
            )}

            {registerMutation.isError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {registerMutation.error instanceof Error
                  ? registerMutation.error.message
                  : "Une erreur est survenue. Veuillez réessayer."}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep("select")} disabled={registerMutation.isPending}>
                Retour
              </Button>
              <Button className="flex-1 bg-teranga-gold hover:bg-teranga-gold/90" onClick={handleConfirm} disabled={registerMutation.isPending}>
                {registerMutation.isPending ? "Inscription..." : "Confirmer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Success */}
      {step === "success" && registration && (
        <div className="mt-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
            <CheckCircle className="h-10 w-10 text-teranga-green" />
          </div>
          <h2 className="mt-4 text-xl font-bold">Inscription confirmée !</h2>
          <p className="mt-2 text-muted-foreground">
            {event.requiresApproval
              ? "Votre inscription est en attente d'approbation."
              : "Votre badge QR a été généré."}
          </p>

          {registration.qrCodeValue && (
            <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
              <QRCodeSVG
                value={registration.qrCodeValue}
                size={200}
                level="M"
                includeMargin
              />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/my-events">
              <Button variant="outline">Mes inscriptions</Button>
            </Link>
            <Link href="/events">
              <Button className="bg-teranga-gold hover:bg-teranga-gold/90">Explorer d&apos;autres événements</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
