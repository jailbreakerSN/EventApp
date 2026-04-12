"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { registrationsApi, badgesApi } from "@/lib/api-client";
import { cacheBadgeInServiceWorker } from "@/hooks/use-badges";
import { Button, Spinner, Card, CardContent } from "@teranga/shared-ui";
import type { Registration, GeneratedBadge } from "@teranga/shared-types";

export default function BadgePage() {
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
        // Cache badge data in service worker for offline access
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

  // Proactively cache badge data in service worker when registration is loaded
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
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted-foreground">Inscription introuvable.</p>
        <Link href="/my-events" className="mt-4 inline-block text-teranga-gold hover:underline">
          Retour à mes inscriptions
        </Link>
      </div>
    );
  }

  const isConfirmed = registration.status === "confirmed" || registration.status === "checked_in";

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link
        href="/my-events"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mes inscriptions
      </Link>

      <h1 className="text-2xl font-bold">Mon badge</h1>

      <Card className="mt-6">
        <CardContent className="flex flex-col items-center py-8">
          {registration.qrCodeValue ? (
            <>
              <div className="rounded-lg bg-white p-4 shadow-inner">
                <QRCodeSVG value={registration.qrCodeValue} size={240} level="M" includeMargin />
              </div>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Présentez ce QR code à l&apos;entrée de l&apos;événement.
              </p>
            </>
          ) : (
            <p className="text-center text-muted-foreground">
              Votre badge n&apos;est pas encore disponible.
            </p>
          )}

          {isConfirmed && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <Button
                variant="outline"
                onClick={handleDownloadPdf}
                disabled={pdfState === "loading"}
                aria-label="Télécharger le badge PDF"
              >
                {pdfState === "loading" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {pdfState === "loading" ? "Génération en cours..." : "Télécharger le badge PDF"}
              </Button>
              {pdfState === "error" && (
                <p className="text-center text-sm text-muted-foreground">
                  La génération du badge PDF a échoué. Réessayez dans quelques instants.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
