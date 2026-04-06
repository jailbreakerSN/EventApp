"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { registrationsApi, badgesApi } from "@/lib/api-client";
import { Button, Spinner, Card, CardContent } from "@teranga/shared-ui";
import type { Registration, GeneratedBadge } from "@teranga/shared-types";

export default function BadgePage() {
  const { registrationId } = useParams<{ registrationId: string }>();

  // We need to get the registration to find the eventId for the badge endpoint
  const { data: regData, isLoading: regLoading } = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
  });

  const registrations = (regData as { data?: Registration[] })?.data as Registration[] | undefined;
  const registration = registrations?.find((r) => r.id === registrationId);

  const { data: badgeData, isLoading: badgeLoading } = useQuery({
    queryKey: ["my-badge", registration?.eventId],
    queryFn: () => badgesApi.getMyBadge(registration!.eventId),
    enabled: !!registration?.eventId,
  });

  const badge = (badgeData as { data?: GeneratedBadge })?.data as GeneratedBadge | undefined;

  const isLoading = regLoading || badgeLoading;

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

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link href="/my-events" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Mes inscriptions
      </Link>

      <h1 className="text-2xl font-bold">Mon badge</h1>

      <Card className="mt-6">
        <CardContent className="flex flex-col items-center py-8">
          {registration.qrCodeValue ? (
            <>
              <div className="rounded-lg bg-white p-4 shadow-inner">
                <QRCodeSVG
                  value={registration.qrCodeValue}
                  size={240}
                  level="M"
                  includeMargin
                />
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

          {badge?.pdfURL && (
            <a
              href={badge.pdfURL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4"
            >
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Télécharger le badge PDF
              </Button>
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
